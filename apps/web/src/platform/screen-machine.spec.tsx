// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider, useBlocker } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { emit, fromPromise, setup } from 'xstate'

import { fakeServices, fakeSession } from './__fixtures__/session'
import { type ConfirmGuard, ConfirmGuardContext } from './confirm-guard.port'
import { type LeaveGuard, LeaveGuardContext } from './leave-guard.port'
import { defineModule } from './module'
import { createAppRouter } from './router'
import { useScreenMachine } from './screen-machine'
import { ServicesProvider } from './services'

type Event =
  | { readonly type: 'x.save-button'; readonly fail: boolean }
  | { readonly type: 'x.nothing-button' }
  | { readonly type: 'x.leave-button' }
  | { readonly type: 'user.sign-in.forgot-link' }
  | { readonly type: 'x.carry-link'; readonly fields: { readonly 'x.y.email-input': string } }
  | { readonly type: 'x.list.open-link'; readonly items: { readonly 'x.list.thing-item': string } }
  | { readonly type: 'user.profile.sign-out-button' }
  | { readonly type: 'organisation.notes.delete-button' }
  | { readonly type: 'x.finish-button' }
  | {
      readonly type: 'platform.password-reset'
      readonly fields: { readonly 'x.y.email-input': string }
    }

/**
 * Two saves in a chain, a button that does nothing, a flow's own move, a leaving control, a
 * control whose action destroys, a platform event that moves with a field's value, and an end.
 */
const machine = setup({
  types: {
    events: {} as Event,
    emitted: {} as {
      type: 'navigate'
      to: string
      search?: Readonly<Record<string, unknown>>
      fields?: Readonly<Record<string, string>>
      items?: Readonly<Record<string, string>>
    },
  },
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
        'x.carry-link': {
          actions: emit(({ event }) => ({
            type: 'navigate' as const,
            to: '/there',
            search: { email: { anchor: 'x.y.email-input' }, view: 'read' },
            fields: event.type === 'x.carry-link' ? event.fields : {},
          })),
        },
        'x.list.open-link': {
          actions: emit(({ event }) => ({
            type: 'navigate' as const,
            to: '/there',
            search: { id: { item: 'x.list.thing-item' }, view: 'read' },
            items: event.type === 'x.list.open-link' ? event.items : {},
          })),
        },
        'user.profile.sign-out-button': 'out',
        'user.sign-in.forgot-link': {
          target: 'moved',
          actions: emit({ type: 'navigate', to: '/there' }),
        },
        'organisation.notes.delete-button': 'deleted',
        'x.finish-button': 'finished',
        'platform.password-reset': {
          target: 'moved',
          actions: emit(({ event }) => ({
            type: 'navigate' as const,
            to: '/there',
            search: { email: { anchor: 'x.y.email-input' } },
            fields: event.type === 'platform.password-reset' ? event.fields : {},
          })),
        },
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
    deleted: { meta: { renders: ['x.deleted-message'] } },
    moved: {},
    finished: { type: 'final' },
  },
})

/** Settles the slow save and fails the background actor, when a test says so. */
const control: { finishSave: () => void; failBackground: () => void } = {
  finishSave: () => {},
  failBackground: () => {},
}

type WatchedEvent =
  | { readonly type: 'x.save-button' }
  | { readonly type: 'x.cancel-button' }
  | { readonly type: 'x.note-button' }
  | { readonly type: 'x.publish-button' }

/** A background actor that runs from the start, beside a slow save and a note that fails. */
const watched = setup({
  types: { events: {} as WatchedEvent },
  actors: {
    note: fromPromise(async () => {
      await Promise.resolve()

      throw new Error('refused')
    }),
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
        saving: {
          invoke: { src: 'save', onDone: 'idle', onError: 'idle' },
          on: {
            'x.cancel-button': 'idle',
            // Saving again starts the save anew: a new actor under the same id.
            'x.save-button': { target: 'saving', reenter: true },
          },
        },
      },
    },
    notes: {
      initial: 'idle',
      states: {
        idle: { on: { 'x.note-button': 'noting' } },
        noting: { invoke: { src: 'note', onDone: 'idle', onError: 'idle' } },
      },
    },
    publish: {
      initial: 'idle',
      states: {
        idle: { on: { 'x.publish-button': 'published' } },
        published: {},
      },
    },
  },
})

type Screen = ReturnType<typeof useScreenMachine<typeof machine>>
type Watched = ReturnType<typeof useScreenMachine<typeof watched>>

const held: { screen?: Screen; watched?: Watched; type?: (email: string) => void } = {}

/** A page whose email field the test types into, which a platform event carries for its move. */
function Page() {
  const [email, setEmail] = useState('ann@example.test')
  const running = useScreenMachine('x', machine, { 'x.y.email-input': email })

  held.screen = running
  held.type = setEmail

  return <output data-testid="state">{String(running.state.value)}</output>
}

function WatchedPage() {
  const running = useScreenMachine('x', watched)

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
    { path: '/here', page: 'Page', roles: ['guest', 'identity'] },
    { path: '/watched', page: 'WatchedPage', roles: ['guest', 'identity'] },
    { path: '/there', page: 'There', roles: ['guest', 'identity'] },
  ],
})

async function open(guard: LeaveGuard, at = '/here', asking: ConfirmGuard = confirming()) {
  const { session } = fakeSession()
  const services = fakeServices(session)
  const router = createAppRouter({
    modules: [PageModule],
    session,
    layout: Blocking,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <ServicesProvider services={services}>
      <ConfirmGuardContext.Provider value={asking}>
        <LeaveGuardContext.Provider value={guard}>
          <RouterProvider router={router} />
        </LeaveGuardContext.Provider>
      </ConfirmGuardContext.Provider>
    </ServicesProvider>,
  )
  await screen.findByTestId('state')

  const running = held.screen

  if (running === undefined) {
    throw new Error('the page did not render')
  }

  return { router, running, services }
}

/** Opens the page of the machine with a background actor, and gives its running screen. */
async function openWatched(): Promise<Watched> {
  await open(passing(), '/watched')

  if (held.watched === undefined) {
    throw new Error('the page did not render')
  }

  return held.watched
}

const passing = (): LeaveGuard => ({
  confirm: vi.fn(() => Promise.resolve(true)),
  before: vi.fn(() => Promise.resolve(true)),
})

/** The frame's confirmation, answering `answer` to every question. */
const confirming = (answer = true): ConfirmGuard => ({
  before: vi.fn(() => Promise.resolve(answer)),
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
    const running = await openWatched()
    let saved: Promise<boolean> = Promise.resolve(false)

    act(() => {
      saved = running.submit({ type: 'x.save-button' })
    })
    await act(async () => control.failBackground())
    await act(async () => control.finishSave())

    expect(await act(() => saved)).toBe(true)
    expect(screen.getByTestId('state').textContent).toContain('"watch":"lost"')
  })

  it('settles a submit when its save ends, though an actor that ran before it still runs', async () => {
    const running = await openWatched()
    let saved: Promise<boolean> = Promise.resolve(false)

    act(() => {
      saved = running.submit({ type: 'x.save-button' })
    })
    await act(async () => control.finishSave())

    expect(await act(() => saved)).toBe(true)
    expect(screen.getByTestId('state').textContent).toContain('"watch":"watching"')
    await act(async () => control.failBackground())
  })

  it('resolves a submit false when its action is stopped before it ends', async () => {
    const running = await openWatched()
    let saved: Promise<boolean> = Promise.resolve(true)

    act(() => {
      saved = running.submit({ type: 'x.save-button' })
    })
    act(() => running.send({ type: 'x.cancel-button' }))

    expect(await act(() => saved)).toBe(false)
  })

  it('resolves a submit false when another submit starts its action anew under the same id', async () => {
    const running = await openWatched()
    let first: Promise<boolean> = Promise.resolve(true)
    let second: Promise<boolean> = Promise.resolve(false)

    act(() => {
      first = running.submit({ type: 'x.save-button' })
    })
    act(() => {
      second = running.submit({ type: 'x.save-button' })
    })

    expect(await act(() => first)).toBe(false)
    await act(async () => control.finishSave())
    expect(await act(() => second)).toBe(true)
  })

  it('resolves false a queued submit whose event the state no longer takes when its turn comes', async () => {
    const running = await openWatched()
    const outcomes: Array<Promise<boolean>> = []
    const asked = running.actor.subscribe((snapshot) => {
      if (snapshot.matches({ notes: 'noting' })) {
        asked.unsubscribe()
        outcomes.push(running.submit({ type: 'x.publish-button' }))
        outcomes.push(running.submit({ type: 'x.publish-button' }))
      }
    })

    await act(async () => running.send({ type: 'x.note-button' }))

    expect(await act(() => Promise.all(outcomes))).toEqual([true, false])
  })

  it('waits for an event sent while the machine is busy, and judges it by its own action', async () => {
    const running = await openWatched()
    let noted: Promise<boolean> = Promise.resolve(true)
    const asked = running.actor.subscribe((snapshot) => {
      if (snapshot.matches({ form: 'saving' })) {
        asked.unsubscribe()
        noted = running.submit({ type: 'x.note-button' })
      }
    })

    await act(async () => running.send({ type: 'x.save-button' }))

    expect(await act(() => noted)).toBe(false)
    await act(async () => control.finishSave())
  })

  it("runs a flow's navigation past the frame's blocker", async () => {
    const { router, running } = await open(passing())

    act(() => running.send({ type: 'x.leave-button' }))

    await screen.findByText('there')
    expect(router.state.location.pathname).toBe('/there')
  })

  it("moves with the value a field of the moving event holds, never the field's anchor", async () => {
    const { router, running } = await open(passing())

    act(() =>
      running.send({ type: 'x.carry-link', fields: { 'x.y.email-input': 'ann@example.test' } }),
    )

    await screen.findByText('there')
    expect(router.state.location.search).toEqual({ email: 'ann@example.test', view: 'read' })
  })

  it('moves with the id of the entry the moving event acted in, never the anchor of its item', async () => {
    const { router, running } = await open(passing())

    act(() => running.send({ type: 'x.list.open-link', items: { 'x.list.thing-item': 'thg_1' } }))

    await screen.findByText('there')
    expect(router.state.location.search).toEqual({ id: 'thg_1', view: 'read' })
  })

  it("brings a platform event to the machine, which moves with what the screen's field holds", async () => {
    const { router, services } = await open(passing())

    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    await screen.findByText('there')
    expect(router.state.location.search).toEqual({ email: 'ann@example.test' })
  })

  it('brings a platform event with what the field holds after the page rendered again', async () => {
    const { router, services } = await open(passing())

    act(() => held.type?.('bob@example.test'))
    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    await screen.findByText('there')
    expect(router.state.location.search).toEqual({ email: 'bob@example.test' })
  })

  it('lets a platform event pass in a state that does not handle it', async () => {
    const { running, services } = await open(passing())

    await act(async () => running.send({ type: 'organisation.notes.delete-button' }))
    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    expect(screen.getByTestId('state').textContent).toBe('deleted')
  })

  it('brings no platform event to a machine that ended', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { running, services } = await open(passing())

    act(() => running.send({ type: 'x.finish-button' }))
    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    expect(running.actor.getSnapshot().status).toBe('done')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
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

  it('asks the guard before a control whose flow leaves its screen, and sends nothing when the user stays', async () => {
    const staying: LeaveGuard = { ...passing(), before: vi.fn(() => Promise.resolve(false)) }
    const { running } = await open(staying)

    await act(async () => running.send({ type: 'user.sign-in.forgot-link' }))

    expect(staying.before).toHaveBeenCalledWith('user.sign-in.forgot-link')
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('submits a control whose flow leaves its screen once the user leaves, past the blocker', async () => {
    const guard = passing()
    const { router, running } = await open(guard)

    expect(await act(() => running.submit({ type: 'user.sign-in.forgot-link' }))).toBe(true)

    await screen.findByText('there')
    expect(guard.before).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/there')
  })

  it('asks the confirmation before the guard, and the guard nothing when the user stays at it', async () => {
    const order: string[] = []
    const guard: LeaveGuard = {
      ...passing(),
      before: vi.fn(() => {
        order.push('guard')

        return Promise.resolve(true)
      }),
    }
    const answers = [false, true]
    const asking: ConfirmGuard = {
      before: vi.fn(() => {
        order.push('confirmation')

        return Promise.resolve(answers.shift() ?? true)
      }),
    }
    const { running } = await open(guard, '/here', asking)

    expect(await act(() => running.submit({ type: 'user.sign-in.forgot-link' }))).toBe(false)
    expect(order).toEqual(['confirmation'])
    expect(screen.getByTestId('state').textContent).toBe('idle')

    expect(await act(() => running.submit({ type: 'user.sign-in.forgot-link' }))).toBe(true)
    expect(order).toEqual(['confirmation', 'confirmation', 'guard'])
  })

  it('asks nothing for a control that asks first when its state does not take the event', async () => {
    const guard = passing()
    const { running } = await open(guard, '/here', confirming())

    await act(async () => running.send({ type: 'organisation.notes.delete-button' }))
    expect(screen.getByTestId('state').textContent).toBe('deleted')

    await act(async () => running.send({ type: 'user.sign-in.forgot-link' }))
    expect(await act(() => running.submit({ type: 'user.sign-in.forgot-link' }))).toBe(false)
    expect(guard.before).not.toHaveBeenCalled()
  })

  it('sends nothing once the user leaves when the state stopped taking the event while it asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answer: { leave: (go: boolean) => void } = { leave: () => {} }
    const asking: LeaveGuard = {
      ...passing(),
      before: vi.fn(
        () =>
          new Promise<boolean>((settle) => {
            answer.leave = settle
          }),
      ),
    }
    const { running } = await open(asking)

    await act(async () => running.send({ type: 'user.sign-in.forgot-link' }))
    expect(asking.before).toHaveBeenCalledWith('user.sign-in.forgot-link')

    act(() => running.send({ type: 'x.finish-button' }))
    await act(async () => answer.leave(true))

    expect(running.actor.getSnapshot().status).toBe('done')
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('asks the confirmation before a destructive control, and sends nothing when the user stays', async () => {
    const staying = confirming(false)
    const { running } = await open(passing(), '/here', staying)

    await act(async () => running.send({ type: 'organisation.notes.delete-button' }))

    expect(staying.before).toHaveBeenCalledWith('organisation.notes.delete-button')
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it('sends a destructive control once confirmed, and asks for no other event', async () => {
    const asking = confirming()
    const guard = passing()
    const { running } = await open(guard, '/here', asking)

    act(() => running.send({ type: 'x.nothing-button' }))
    expect(asking.before).not.toHaveBeenCalled()

    expect(await act(() => running.submit({ type: 'organisation.notes.delete-button' }))).toBe(true)
    expect(asking.before).toHaveBeenCalledWith('organisation.notes.delete-button')
    expect(guard.before).not.toHaveBeenCalled()
    expect(screen.getByTestId('state').textContent).toBe('deleted')
  })

  it('resolves a destructive submit false when the user stays, and sends nothing', async () => {
    const { running } = await open(passing(), '/here', confirming(false))

    expect(await act(() => running.submit({ type: 'organisation.notes.delete-button' }))).toBe(
      false,
    )
    expect(screen.getByTestId('state').textContent).toBe('idle')
  })

  it("tells what the machine's state renders, read from its states' meta.renders", async () => {
    const { running } = await open(passing())

    expect(running.renders('x.deleted-message')).toBe(false)
    expect(running.renders('x.y.email-input')).toBe(true)
    expect(await act(() => running.submit({ type: 'organisation.notes.delete-button' }))).toBe(true)
    expect(held.screen?.renders('x.deleted-message')).toBe(true)
  })
})
