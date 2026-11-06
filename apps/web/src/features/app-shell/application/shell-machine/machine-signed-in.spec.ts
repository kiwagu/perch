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
const SIGN_IN_NOTICE_CLEARED = { type: 'clear', anchor: 'user.sign-in.notice-message' }

/** Each state of the frame that hears a sign-in, the account saved, and the way there. */
const STATES: ReadonlyArray<readonly [string, string | undefined, readonly ShellEvent[]]> = [
  ['opening-data', 'idn_ann', [STARTED]],
  ['failed', 'idn_ann', [STARTED, { type: 'platform.open-failed' }]],
  ['ready', undefined, [STARTED]],
  ['crashed', undefined, [STARTED, { type: 'platform.crashed' }]],
  [
    'reloading',
    undefined,
    [STARTED, { type: 'platform.crashed' }, { type: 'app-shell.reload-button' }],
  ],
  ['updating', undefined, [STARTED, { type: 'app-shell.update-button' }]],
  ['installing', undefined, [STARTED, { type: 'app-shell.install-button' }]],
  ['postponing', undefined, [STARTED, { type: 'app-shell.install-later-button' }]],
]

describe('shell machine, a sign-in on this device', () => {
  it.each(STATES)(
    'drops the words the sign-in page has not said yet in %s, and stays there',
    (state, account, way) => {
      const { actor, emitted } = frame(account)

      for (const event of way) {
        actor.send(event)
      }

      expect(actor.getSnapshot().value).toBe(state)

      const before = emitted.length

      actor.send({ type: 'platform.signed-in' })

      expect(emitted.slice(before)).toEqual([SIGN_IN_NOTICE_CLEARED])
      expect(actor.getSnapshot().value).toBe(state)
    },
  )

  it('hears none before the start ends', () => {
    const { actor, emitted } = frame()

    actor.send({ type: 'platform.signed-in' })

    expect(emitted).toEqual([])
    expect(actor.getSnapshot().value).toBe('opening')
  })
})
