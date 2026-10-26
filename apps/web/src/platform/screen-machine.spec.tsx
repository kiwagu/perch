// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider, useBlocker } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { emit, fromPromise, setup } from 'xstate'

import { fakeServices, fakeSession } from './__fixtures__/session'
import { type LeaveGuard, LeaveGuardContext } from './leave-guard.port'
import { defineModule } from './module'
import { createAppRouter } from './router'
import { useScreenMachine } from './screen-machine'
import { ServicesProvider } from './services'

type Event =
  | { readonly type: 'x.save-button'; readonly fail: boolean }
  | { readonly type: 'x.nothing-button' }
  | { readonly type: 'x.leave-button' }
  | { readonly type: 'user.profile.sign-out-button' }

/** Two saves in a chain, a button that does nothing, a flow's own move, and a leaving control. */
const machine = setup({
  types: { events: {} as Event, emitted: {} as { type: 'navigate'; to: string } },
  actors: {
    save: fromPromise(async ({ input }: { input: { fail: boolean } }) => {
      await Promise.resolve()

      if (input.fail) {
        throw new Error('refused')
      }
    }),
  },
}).createMachine({
  initial: 'idle',
  states: {
    idle: {
      on: {
        'x.save-button': 'saving-one',
        'x.nothing-button': { actions: emit({ type: 'navigate', to: '/here' }) },
        'x.leave-button': { actions: emit({ type: 'navigate', to: '/there' }) },
        'user.profile.sign-out-button': 'out',
      },
    },
    'saving-one': {
      invoke: {
        src: 'save',
        input: ({ event }) => ({ fail: event.type === 'x.save-button' && event.fail }),
        onDone: 'saving-two',
        onError: 'idle',
      },
    },
    'saving-two': { invoke: { src: 'save', input: () => ({ fail: false }), onDone: 'idle' } },
    out: {},
  },
})

/** Settles the slow save and fails the background actor, when a test says so. */
const control: { finishSave: () => void; failBackground: () => void } = {
  finishSave: () => {},
  failBackground: () => {},
}

/** A background actor that runs from the start, beside a slow save. */
const watched = setup({
  types: { events: {} as { readonly type: 'x.save-button' } },
  actors: {
    background: fromPromise(
      () =>
        new Promise<void>((_, reject) => {
          control.failBackground = () => reject(new Error('lost'))
        }),
    ),
    save: fromPromise(
      () =>
        new Promise<void>((resolve) => {
          control.finishSave = resolve
        }),
    ),
  },
}).createMachine({
  type: 'parallel',
  states: {
    watch: {
      initial: 'watching',
      states: {
        watching: { invoke: { src: 'background', onError: 'lost' } },
        lost: {},
      },
    },
    form: {
      initial: 'idle',
      states: {
        idle: { on: { 'x.save-button': 'saving' } },
        saving: { invoke: { src: 'save', onDone: 'idle', onError: 'idle' } },
      },
    },
  },
})

type Screen = ReturnType<typeof useScreenMachine<typeof machine>>
type Watched = ReturnType<typeof useScreenMachine<typeof watched>>

const held: { screen?: Screen; watched?: Watched } = {}

function Page() {
  const running = useScreenMachine(machine)

  held.screen = running

  return <output data-testid="state">{String(running.state.value)}</output>
}

function WatchedPage() {
  const running = useScreenMachine(watched)

  held.watched = running

  return <output data-testid="state">{JSON.stringify(running.state.value)}</output>
}

/** A layout whose blocker refuses every move it is asked about. */
function Blocking() {
  useBlocker({ shouldBlockFn: () => true })

  return <Outlet />
}

const PageModule = defineModule({
  id: 'page',
  declarations: { Page, WatchedPage, There: () => <p>there</p> },
  routes: [
    { path: '/here', page: 'Page' },
    { path: '/watched', page: 'WatchedPage' },
    { path: '/there', page: 'There' },
  ],
})

async function open(guard: LeaveGuard, at = '/here') {
  const { session } = fakeSession()
  const router = createAppRouter({
    modules: [PageModule],
    session,
    layout: Blocking,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <ServicesProvider services={fakeServices(session)}>
      <LeaveGuardContext.Provider value={guard}>
        <RouterProvider router={router} />
      </LeaveGuardContext.Provider>
    </ServicesProvider>,
  )
  await screen.findByTestId('state')

  const running = held.screen

  if (running === undefined) {
    throw new Error('the page did not render')
  }

  return { router, running }
}

const passing = (): LeaveGuard => ({
  confirm: vi.fn(() => Promise.resolve(true)),
  before: vi.fn(() => Promise.resolve(true)),
})

describe('useScreenMachine', () => {
  it('resolves a submit once the chain it started has ended, true when nothing failed', async () => {
    const { running } = await open(passing())
    let outcome: Promise<boolean> = Promise.resolve(false)

    act(() => {
      outcome = running.submit({ type: 'x.save-button', fail: false })
    })
    expect(screen.getByTestId('state').textContent).toBe('saving-one')

    const saved = await act(() => outcome)

    expect(saved).toBe(true)
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('resolves a submit false when an action of its chain failed', async () => {
    const { running } = await open(passing())

    expect(await act(() => running.submit({ type: 'x.save-button', fail: true }))).toBe(false)
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('resolves a submit that started no action true at once', async () => {
    const { running } = await open(passing())

    expect(await act(() => running.submit({ type: 'x.nothing-button' }))).toBe(true)
  })

  it('resolves a submit false when the state does not take its event, and keeps the first one going', async () => {
    const { running } = await open(passing())
    let first: Promise<boolean> = Promise.resolve(false)

    act(() => {
      first = running.submit({ type: 'x.save-button', fail: false })
    })

    expect(await act(() => running.submit({ type: 'x.save-button', fail: false }))).toBe(false)
    expect(await act(() => first)).toBe(true)
  })

  it('judges a submit only by the actions it started, not by one that ran before it', async () => {
    await open(passing(), '/watched')

    const running = held.watched

    if (running === undefined) {
      throw new Error('the page did not render')
    }

    let saved: Promise<boolean> = Promise.resolve(false)

    act(() => {
      saved = running.submit({ type: 'x.save-button' })
    })
    await act(async () => control.failBackground())
    await act(async () => control.finishSave())

    expect(await act(() => saved)).toBe(true)
    expect(screen.getByTestId('state').textContent).toContain('"watch":"lost"')
  })

  it("runs a flow's navigation past the frame's blocker", async () => {
    const { router, running } = await open(passing())

    act(() => running.send({ type: 'x.leave-button' }))

    await screen.findByText('there')
    expect(router.state.location.pathname).toBe('/there')
  })

  it('asks the guard before a leaving control, and sends nothing when the user stays', async () => {
    const guard = passing()
    const staying: LeaveGuard = { ...guard, before: vi.fn(() => Promise.resolve(false)) }
    const { running } = await open(staying)

    await act(async () => running.send({ type: 'user.profile.sign-out-button' }))

    expect(staying.before).toHaveBeenCalledWith('user.profile.sign-out-button')
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('sends a leaving control once the user leaves, and never asks for any other event', async () => {
    const guard = passing()
    const { running } = await open(guard)

    act(() => running.send({ type: 'x.nothing-button' }))
    expect(guard.before).not.toHaveBeenCalled()

    await act(async () => running.send({ type: 'user.profile.sign-out-button' }))

    expect(guard.before).toHaveBeenCalledWith('user.profile.sign-out-button')
    expect(screen.getByTestId('state').textContent).toBe('out')
  })
})
