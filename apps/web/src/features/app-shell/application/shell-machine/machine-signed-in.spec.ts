import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import { NOTHING_SEEN } from '../setting-writes'

import { createShellMachine, FRAME_STATES, type ShellEvent } from '.'

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

/** A state of the frame, as the value `matches` takes. */
type Shown = 'opening-data' | 'failed' | (typeof FRAME_STATES)[keyof typeof FRAME_STATES]

/** Each state of the frame that hears a sign-in, the account saved, and the way there. */
const STATES: ReadonlyArray<readonly [string, string | undefined, readonly ShellEvent[], Shown]> = [
  ['opening-data', 'idn_ann', [STARTED], 'opening-data'],
  ['failed', 'idn_ann', [STARTED, { type: 'platform.open-failed' }], 'failed'],
  ['ready', undefined, [STARTED], FRAME_STATES.ready],
  ['crashed', undefined, [STARTED, { type: 'platform.crashed' }], FRAME_STATES.crashed],
  [
    'reloading',
    undefined,
    [STARTED, { type: 'platform.crashed' }, { type: 'app-shell.reload-button' }],
    FRAME_STATES.reloading,
  ],
  ['updating', undefined, [STARTED, { type: 'app-shell.update-button' }], FRAME_STATES.updating],
  [
    'installing',
    undefined,
    [STARTED, { type: 'app-shell.install-button' }],
    FRAME_STATES.installing,
  ],
  [
    'postponing',
    undefined,
    [STARTED, { type: 'app-shell.install-later-button' }],
    FRAME_STATES.postponing,
  ],
]

describe('shell machine, a sign-in on this device', () => {
  it.each(STATES)(
    'drops the words the sign-in page has not said yet in %s, and stays there',
    (_name, account, way, state) => {
      const { actor, emitted } = frame(account)

      for (const event of way) {
        actor.send(event)
      }

      expect(actor.getSnapshot().matches(state)).toBe(true)

      const before = emitted.length

      actor.send({ type: 'platform.signed-in' })

      expect(emitted.slice(before)).toEqual([SIGN_IN_NOTICE_CLEARED])
      expect(actor.getSnapshot().matches(state)).toBe(true)
    },
  )

  it('hears none before the start ends', () => {
    const { actor, emitted } = frame()

    actor.send({ type: 'platform.signed-in' })

    expect(emitted).toEqual([])
    expect(actor.getSnapshot().value).toBe('opening')
  })
})
