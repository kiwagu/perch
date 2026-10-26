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
        'x.nothing-button': {},
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

type Screen = ReturnType<typeof useScreenMachine<typeof machine>>

const held: { screen?: Screen } = {}

function Page() {
  const running = useScreenMachine(machine)

  held.screen = running

  return <output data-testid="state">{String(running.state.value)}</output>
}

/** A layout whose blocker refuses every move it is asked about. */
function Blocking() {
  useBlocker({ shouldBlockFn: () => true })

  return <Outlet />
}

const PageModule = defineModule({
  id: 'page',
  declarations: { Page, There: () => <p>there</p> },
  routes: [
    { path: '/here', page: 'Page' },
    { path: '/there', page: 'There' },
  ],
})

async function open(guard: LeaveGuard) {
  const { session } = fakeSession()
  const router = createAppRouter({
    modules: [PageModule],
    session,
    layout: Blocking,
    history: createMemoryHistory({ initialEntries: ['/here'] }),
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
