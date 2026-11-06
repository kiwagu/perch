import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import { NOTHING_SEEN } from '../setting-writes'

import { createShellMachine, type ShellEvent } from '.'

/** The frame's machine, for a guest or the saved `account`, and what it emitted. */
function frame(account?: string) {
  const actor = createActor(
    createShellMachine({
      values: () => ({ account, stored: undefined, writes: NOTHING_SEEN, unsaved: false }),
      signOutHere: () => okAsync(undefined),
      reload: vi.fn(),
      setTheme: vi.fn(),
      followTheme: vi.fn(),
      selfReloads: { done: () => false, mark: vi.fn() },
      // The browser's window to install the app stays open.
      install: { prompt: () => new Promise<void>(() => {}), postpone: vi.fn() },
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return { actor, emitted }
}

const STARTED: ShellEvent = { type: 'platform.started' }
/** The notice goes with the account it was raised for, the state of its sync too. */
const ACCOUNT_MESSAGES_CLEARED = [
  { type: 'clear', anchor: 'app-shell.notice-message' },
  { type: 'clear', anchor: 'app-shell.sync-message' },
]

/** Each state of the frame that hears a sign-out, the account saved, the way there, and where it goes. */
const STATES: ReadonlyArray<readonly [string, string | undefined, readonly ShellEvent[], string]> =
  [
    ['opening-data', 'idn_ann', [STARTED], 'ready'],
    ['failed', 'idn_ann', [STARTED, { type: 'platform.open-failed' }], 'ready'],
    ['ready', undefined, [STARTED], 'ready'],
    ['crashed', undefined, [STARTED, { type: 'platform.crashed' }], 'crashed'],
    [
      'reloading',
      undefined,
      [STARTED, { type: 'platform.crashed' }, { type: 'app-shell.reload-button' }],
      'reloading',
    ],
    ['updating', undefined, [STARTED, { type: 'app-shell.update-button' }], 'updating'],
    ['installing', undefined, [STARTED, { type: 'app-shell.install-button' }], 'installing'],
    ['postponing', undefined, [STARTED, { type: 'app-shell.install-later-button' }], 'postponing'],
  ]

describe('shell machine, a sign-out on this device or from another', () => {
  it.each(STATES)(
    "drops the account's notice and the state of its sync in %s",
    (state, account, way, next) => {
      const { actor, emitted } = frame(account)

      for (const event of way) {
        actor.send(event)
      }

      expect(actor.getSnapshot().value).toBe(state)

      const before = emitted.length

      actor.send({ type: 'platform.signed-out' })

      expect(emitted.slice(before)).toEqual(ACCOUNT_MESSAGES_CLEARED)
      expect(actor.getSnapshot().value).toBe(next)
    },
  )

  it('hears none before the start ends', () => {
    const { actor, emitted } = frame('idn_ann')

    actor.send({ type: 'platform.signed-out' })

    expect(emitted).toEqual([])
    expect(actor.getSnapshot().value).toBe('opening')
  })
})
