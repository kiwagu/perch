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
/** The notice goes with the account it was raised for, the state of its sync too. */
const ACCOUNT_MESSAGES_CLEARED = [
  { type: 'clear', anchor: 'app-shell.notice-message' },
  { type: 'clear', anchor: 'app-shell.sync-message' },
]

/** A state of the frame, as the value `matches` takes. */
type Shown = 'opening-data' | 'failed' | (typeof FRAME_STATES)[keyof typeof FRAME_STATES]

/** What a guest's frame shows once its data is open and nothing else has happened. */
const OPENED = [FRAME_STATES.ready, FRAME_STATES.offering] as const

/**
 * Each state of the frame that hears a sign-out, the account saved, the way there, and the states
 * it holds after.
 */
const STATES: ReadonlyArray<
  readonly [string, string | undefined, readonly ShellEvent[], Shown, readonly Shown[]]
> = [
  ['opening-data', 'idn_ann', [STARTED], 'opening-data', OPENED],
  ['failed', 'idn_ann', [STARTED, { type: 'platform.open-failed' }], 'failed', OPENED],
  ['ready', undefined, [STARTED], FRAME_STATES.ready, [FRAME_STATES.ready]],
  [
    'crashed',
    undefined,
    [STARTED, { type: 'platform.crashed' }],
    FRAME_STATES.crashed,
    [FRAME_STATES.crashed],
  ],
  [
    'reloading',
    undefined,
    [STARTED, { type: 'platform.crashed' }, { type: 'app-shell.reload-button' }],
    FRAME_STATES.reloading,
    [FRAME_STATES.reloading],
  ],
  [
    'updating',
    undefined,
    [STARTED, { type: 'app-shell.update-button' }],
    FRAME_STATES.updating,
    [FRAME_STATES.updating],
  ],
  [
    'installing',
    undefined,
    [STARTED, { type: 'app-shell.install-button' }],
    FRAME_STATES.installing,
    [FRAME_STATES.installing],
  ],
  [
    'postponing',
    undefined,
    [STARTED, { type: 'app-shell.install-later-button' }],
    FRAME_STATES.postponing,
    [FRAME_STATES.postponing],
  ],
]

describe('shell machine, a sign-out on this device or from another', () => {
  it.each(STATES)(
    "drops the account's notice and the state of its sync in %s",
    (_name, account, way, state, next) => {
      const { actor, emitted } = frame(account)

      for (const event of way) {
        actor.send(event)
      }

      expect(actor.getSnapshot().matches(state)).toBe(true)

      const before = emitted.length

      actor.send({ type: 'platform.signed-out' })

      expect(emitted.slice(before)).toEqual(ACCOUNT_MESSAGES_CLEARED)

      for (const held of next) {
        expect(actor.getSnapshot().matches(held)).toBe(true)
      }
    },
  )

  it('hears none before the start ends', () => {
    const { actor, emitted } = frame('idn_ann')

    actor.send({ type: 'platform.signed-out' })

    expect(emitted).toEqual([])
    expect(actor.getSnapshot().value).toBe('opening')
  })
})
