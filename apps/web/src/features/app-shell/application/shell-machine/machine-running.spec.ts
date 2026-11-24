import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'

import type { Theme } from '../../../../platform/theme'
import { NOTHING_SEEN } from '../setting-writes'

import { FRAME_MESSAGES } from './transitions'
import { createShellMachine, FRAME_STATES, type ShellEvent } from '.'

/**
 * A guest's frame whose stored settings another tab or device just changed, and what it emitted;
 * the browser's window to install the app stays open until `endPrompt`.
 */
function frame() {
  let endPrompt = () => {}
  const reload = vi.fn<() => void>()
  const setTheme = vi.fn<(theme: Theme) => void>()
  const followTheme = vi.fn<() => void>()
  const actor = createActor(
    createShellMachine({
      values: () => ({
        account: undefined,
        stored: { locale: 'es', theme: 'dark' },
        writes: NOTHING_SEEN,
        unsaved: false,
      }),
      signOutHere: () => okAsync(undefined),
      reload,
      setTheme,
      followTheme,
      selfReloads: { done: () => false, mark: vi.fn() },
      install: {
        prompt: () =>
          new Promise<void>((resolve) => {
            endPrompt = resolve
          }),
        postpone: vi.fn(),
      },
    }),
  ).start()
  const emitted: unknown[] = []

  actor.on('*', (event) => emitted.push(event))

  return {
    actor,
    emitted,
    reload,
    setTheme,
    followTheme,
    endPrompt: () => endPrompt(),
    /** The start ends, and `way` leads to the configuration a test wants the frame in. */
    reach: (way: readonly ShellEvent[]) => {
      for (const event of [STARTED, ...way]) {
        actor.send(event)
      }
    },
    can: (event: ShellEvent) => actor.getSnapshot().can(event),
    matches: (state: Held) => actor.getSnapshot().matches(state),
  }
}

/** A state of one region of `running`, as the value `matches` takes. */
type Held = (typeof FRAME_STATES)[keyof typeof FRAME_STATES]

const STARTED: ShellEvent = { type: 'platform.started' }
const CRASH: ShellEvent = { type: 'platform.crashed' }
const RELOAD: ShellEvent = { type: 'app-shell.reload-button' }
const UPDATE: ShellEvent = { type: 'app-shell.update-button' }
const INSTALL: ShellEvent = { type: 'app-shell.install-button' }
const LATER: ShellEvent = { type: 'app-shell.install-later-button' }
const HIDDEN: ShellEvent = { type: 'platform.tab-hidden' }
const SERVED = '0.2.0+2b9a0c1d'
const NEW_VERSION: ShellEvent = { type: 'platform.new-version', served: SERVED }

const shown = (anchor: string, code: string) => ({ type: 'show', anchor, codes: [code] })
const cleared = (anchor: string) => ({ type: 'clear', anchor })

/** One message of the frame: the event, and what it makes the frame emit and call. */
interface Message {
  readonly event: ShellEvent
  readonly emits: readonly object[]
  /** The device service it calls, once, besides what it emits. */
  readonly calls?: 'followTheme' | 'setTheme'
}

/** The messages `running` takes, the theme select aside, each as the frame takes it in `ready`. */
const MESSAGES: Readonly<Record<string, Message>> = {
  'platform.theme-set': {
    event: { type: 'platform.theme-set' },
    emits: [],
    calls: 'followTheme',
  },
  'model.settings.locale': {
    event: { type: 'model.settings.locale' },
    emits: [{ type: 'speak', locale: 'es' }],
  },
  'model.settings.theme': {
    event: { type: 'model.settings.theme' },
    emits: [],
    calls: 'setTheme',
  },
  'platform.signed-in': {
    event: { type: 'platform.signed-in' },
    emits: [cleared('user.sign-in.notice-message')],
  },
  'platform.signed-out': {
    event: { type: 'platform.signed-out' },
    emits: [cleared('app-shell.notice-message'), cleared('app-shell.sync-message')],
  },
  'platform.change-rejected': {
    event: { type: 'platform.change-rejected' },
    emits: [shown('app-shell.notice-message', 'change-rejected')],
  },
  'platform.changes-reloaded': {
    event: { type: 'platform.changes-reloaded' },
    emits: [shown('app-shell.notice-message', 'changes-reloaded')],
  },
  'platform.new-version': {
    event: NEW_VERSION,
    emits: [shown('app-shell.update-message', 'new-version')],
  },
  'platform.protocol-refused': {
    event: { type: 'platform.protocol-refused' },
    emits: [shown('app-shell.update-message', 'protocol-outdated')],
  },
  'platform.synced': {
    event: { type: 'platform.synced' },
    emits: [shown('app-shell.sync-message', 'synced')],
  },
  'platform.sending': {
    event: { type: 'platform.sending' },
    emits: [shown('app-shell.sync-message', 'sending')],
  },
  'platform.connecting': {
    event: { type: 'platform.connecting' },
    emits: [shown('app-shell.sync-message', 'connecting')],
  },
  'platform.offline': {
    event: { type: 'platform.offline' },
    emits: [shown('app-shell.sync-message', 'offline')],
  },
  'platform.sync-stopped': {
    event: { type: 'platform.sync-stopped' },
    emits: [shown('app-shell.sync-message', 'sync-stopped')],
  },
  'platform.install-offered': {
    event: { type: 'platform.install-offered' },
    emits: [shown('app-shell.install-message', 'install-available')],
  },
  'platform.install-by-steps': {
    event: { type: 'platform.install-by-steps' },
    emits: [shown('app-shell.install-message', 'install-by-steps')],
  },
  'platform.installed': {
    event: { type: 'platform.installed' },
    emits: [cleared('app-shell.install-message')],
  },
}

/** The way from the start to each configuration of `running` the tests look at. */
const WAYS = {
  ready: [],
  crashed: [CRASH],
  reloading: [CRASH, RELOAD],
  updating: [UPDATE],
  installing: [INSTALL],
  postponing: [LATER],
} as const satisfies Record<string, readonly ShellEvent[]>

/** Each configuration of the screen with the reminder offering, and of the reminder with the screen as usual. */
const CONFIGURATIONS: ReadonlyArray<readonly [string, readonly ShellEvent[], readonly Held[]]> = [
  ['ready', WAYS.ready, [FRAME_STATES.ready, FRAME_STATES.offering]],
  ['crashed', WAYS.crashed, [FRAME_STATES.crashed, FRAME_STATES.offering]],
  ['reloading', WAYS.reloading, [FRAME_STATES.reloading, FRAME_STATES.offering]],
  ['updating', WAYS.updating, [FRAME_STATES.updating, FRAME_STATES.offering]],
  ['installing', WAYS.installing, [FRAME_STATES.ready, FRAME_STATES.installing]],
  ['postponing', WAYS.postponing, [FRAME_STATES.ready, FRAME_STATES.postponing]],
]

describe('shell machine, the messages of the running frame', () => {
  it("holds the messages the machine's config takes, and no others", () => {
    expect(Object.keys(MESSAGES).sort()).toEqual(
      Object.keys(FRAME_MESSAGES)
        .filter((type) => type !== 'app-shell.theme-select')
        .sort(),
    )
  })

  it.each(Object.entries(MESSAGES))(
    'takes %s whatever the screen and the reminder are doing',
    (type, { event, emits, calls }) => {
      for (const [name, way, held] of CONFIGURATIONS) {
        const where = `${type} in ${name}`
        const shell = frame()

        shell.reach(way)

        for (const state of held) {
          expect(shell.matches(state), `${where}: the way there`).toBe(true)
        }

        const before = shell.emitted.length
        const value = shell.actor.getSnapshot().value

        shell.actor.send(event)

        expect(shell.emitted.slice(before), where).toEqual(emits)
        expect(shell.actor.getSnapshot().value, where).toEqual(value)

        if (calls !== undefined) {
          expect(shell[calls], where).toHaveBeenCalledOnce()
        }
      }
    },
  )

  it('moves only the screen to crashed while the install window is open, and the answer still clears the reminder', async () => {
    const shell = frame()

    shell.reach([{ type: 'platform.install-offered' }, INSTALL, CRASH])

    expect(shell.matches(FRAME_STATES.crashed)).toBe(true)
    expect(shell.matches(FRAME_STATES.installing)).toBe(true)
    expect(shell.emitted.at(-1)).toEqual(shown('app-shell.crash-message', 'screen-crashed'))

    shell.endPrompt()
    await waitFor(shell.actor, (state) => state.matches(FRAME_STATES.offering))

    expect(shell.emitted.at(-1)).toEqual(cleared('app-shell.install-message'))
    expect(shell.matches(FRAME_STATES.crashed)).toBe(true)
  })

  it('offers the install buttons only while the screen shows as usual', () => {
    for (const [name, expected] of [
      ['ready', true],
      ['crashed', false],
      ['reloading', false],
      ['updating', false],
    ] as const) {
      const shell = frame()

      shell.reach(WAYS[name])

      expect(shell.can(INSTALL), `${name}: install`).toBe(expected)
      expect(shell.can(LATER), `${name}: later`).toBe(expected)
    }
  })

  it('starts no quiet reload while the install window is open, and the next hide after it does', async () => {
    const shell = frame()

    shell.reach([NEW_VERSION, INSTALL, HIDDEN])

    expect(shell.matches(FRAME_STATES.ready)).toBe(true)
    expect(shell.matches(FRAME_STATES.installing)).toBe(true)
    expect(shell.reload).not.toHaveBeenCalled()

    shell.endPrompt()
    await waitFor(shell.actor, (state) => state.matches(FRAME_STATES.offering))

    // The window closing starts no reload by itself; the next time the tab goes to the background does.
    expect(shell.reload).not.toHaveBeenCalled()

    shell.actor.send(HIDDEN)

    expect(shell.matches(FRAME_STATES.updating)).toBe(true)
    expect(shell.reload).toHaveBeenCalledOnce()
  })

  it('leaves the update button and the guest selects on while the install window is open', () => {
    const shell = frame()

    shell.reach([NEW_VERSION, INSTALL])

    expect(shell.matches(FRAME_STATES.installing)).toBe(true)
    expect(shell.can(UPDATE)).toBe(true)
    expect(shell.can({ type: 'app-shell.locale-select', locale: 'es' })).toBe(true)
    expect(shell.can({ type: 'app-shell.theme-select', theme: 'dark' })).toBe(true)
  })

  it('the theme select applies in every configuration of running', () => {
    for (const [name, way] of CONFIGURATIONS) {
      const shell = frame()

      shell.reach(way)
      shell.actor.send({ type: 'app-shell.theme-select', theme: 'light' })

      expect(shell.setTheme.mock.calls, name).toEqual([['light']])
    }
  })
})
