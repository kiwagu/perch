import type { ResultAsync } from 'neverthrow'
import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'

import type { Theme } from '../../../platform/theme'

import type { LocaleWrites } from './locale-writes'

/** What the frame's guards read at the moment they are asked. */
export interface ShellValues {
  /** The account signed in on this device; none for a guest. */
  readonly account: string | undefined
  /** The language the account's settings hold on this device; none before they arrive. */
  readonly stored: string | undefined
  /** What this device knows of the stored language and of its own writes on their way. */
  readonly writes: LocaleWrites
  /** Whether a field holds unsaved input now. */
  readonly unsaved: boolean
}

/**
 * An update the frame heard since the page loaded: the code its message says, and the update
 * itself (the build the server serves, or the protocol it refused), which a reload by itself
 * happens once for.
 */
export interface PendingUpdate {
  readonly code: 'new-version' | 'protocol-outdated'
  readonly update: string
}

/** The updates this tab loaded the page again for by itself, kept for the tab's life. */
export interface SelfReloads {
  readonly done: (update: string) => boolean
  readonly mark: (update: string) => void
}

interface ShellContext {
  readonly pending: PendingUpdate | undefined
}

export type ShellEvent =
  | { readonly type: 'platform.opened' }
  | { readonly type: 'platform.open-failed' }
  | { readonly type: 'platform.storage-blocked' }
  | { readonly type: 'app-shell.locale-select'; readonly locale: Locale }
  | { readonly type: 'app-shell.theme-select'; readonly theme: Theme }
  | { readonly type: 'model.settings.locale' }
  | { readonly type: 'app-shell.sign-out-here-button' }
  | { readonly type: 'platform.signed-out' }
  | { readonly type: 'platform.change-rejected' }
  | { readonly type: 'platform.changes-reloaded' }
  | { readonly type: 'platform.crashed' }
  | { readonly type: 'platform.navigated' }
  | { readonly type: 'app-shell.reload-button' }
  | { readonly type: 'platform.new-version'; readonly served: string }
  | { readonly type: 'platform.protocol-refused' }
  | { readonly type: 'platform.tab-hidden' }
  | { readonly type: 'app-shell.update-button' }
  | { readonly type: 'platform.synced' }
  | { readonly type: 'platform.sending' }
  | { readonly type: 'platform.connecting' }
  | { readonly type: 'platform.offline' }
  | { readonly type: 'platform.sync-stopped' }
  | { readonly type: 'platform.install-offered' }
  | { readonly type: 'platform.install-by-steps' }
  | { readonly type: 'platform.installed' }
  | { readonly type: 'app-shell.install-button' }
  | { readonly type: 'app-shell.install-later-button' }

/**
 * The params of the flow's effects: an anchor shows one of the codes, or none any more; the app
 * moves to a path.
 */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

interface ClearParams {
  readonly anchor: string
}

interface NavigateParams {
  readonly to: string
}

/** The flow's effects, and the language the app is to speak. */
export type ShellEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)
  | { readonly type: 'speak'; readonly locale: Locale }

export interface ShellMachineDeps {
  readonly values: () => ShellValues
  /** Signs the saved account out on this device, when its data did not open. */
  readonly signOutHere: () => ResultAsync<unknown, unknown>
  /** Loads the page again from the server. */
  readonly reload: () => void
  /** Shows a theme on this device and keeps it there. */
  readonly setTheme: (theme: Theme) => void
  readonly selfReloads: SelfReloads
  /** Installing the app on this device: the browser's own window, or the reminder put off. */
  readonly install: { readonly prompt: () => Promise<void>; readonly postpone: () => void }
}

/** A result that resolves once done, or rejects with its failure. */
async function settled<T>(result: ResultAsync<T, unknown>): Promise<T> {
  const outcome = await result

  return outcome.isOk() ? outcome.value : Promise.reject(outcome.error)
}

const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const
/** The notice goes with the account that was signed in when it was raised, the state of its sync too. */
const SIGNED_OUT = {
  actions: [
    { type: 'clear', params: { anchor: 'app-shell.notice-message' } },
    { type: 'clear', params: { anchor: 'app-shell.sync-message' } },
  ],
} as const
/** The gateway refused a change this device then undid, or refused the undo too. */
const REJECTED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['change-rejected'] },
} as const
const RELOADED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['changes-reloaded'] },
} as const
/** The open screen failed to render: the frame says so in its place, until it goes. */
const CRASHED = {
  type: 'show',
  params: { anchor: 'app-shell.crash-message', codes: ['screen-crashed'] },
} as const
const CRASH_GONE = { type: 'clear', params: { anchor: 'app-shell.crash-message' } } as const
/** A theme chosen applies at once, whatever the frame is doing. */
const THEME_CHOSEN = { actions: 'applyTheme' } as const
/**
 * The server serves a newer build, or no longer takes this build's protocol: the frame offers to
 * load the page again, and a refused protocol, which says more, keeps its message.
 */
const NEW_VERSION = {
  guard: 'protocolTaken',
  actions: [
    'noteVersion',
    { type: 'show', params: { anchor: 'app-shell.update-message', codes: ['new-version'] } },
  ],
} as const
/** The state of this device's sync, as the platform says it. */
const syncShows = (code: 'synced' | 'sending' | 'connecting' | 'offline' | 'sync-stopped') =>
  ({
    actions: { type: 'show', params: { anchor: 'app-shell.sync-message', codes: [code] } },
  }) as const
const SYNC = {
  'platform.synced': syncShows('synced'),
  'platform.sending': syncShows('sending'),
  'platform.connecting': syncShows('connecting'),
  'platform.offline': syncShows('offline'),
  'platform.sync-stopped': syncShows('sync-stopped'),
} as const
/** The reminder to install the app, until it is installed or put off. */
const INSTALL_AVAILABLE = {
  actions: {
    type: 'show',
    params: { anchor: 'app-shell.install-message', codes: ['install-available'] },
  },
} as const
const INSTALL_BY_STEPS = {
  actions: {
    type: 'show',
    params: { anchor: 'app-shell.install-message', codes: ['install-by-steps'] },
  },
} as const
const INSTALL_GONE = { type: 'clear', params: { anchor: 'app-shell.install-message' } } as const
const PROTOCOL_OUTDATED = {
  actions: [
    'noteProtocol',
    { type: 'show', params: { anchor: 'app-shell.update-message', codes: ['protocol-outdated'] } },
  ],
} as const

/** The frame's flow (`contract/domain/screens/__root.yaml`) as the app runs it. */
export function createShellMachine(deps: ShellMachineDeps) {
  /** The stored language, when another device stored it and this one has not seen it yet. */
  const storedElsewhere = (): Locale | undefined => {
    const { stored, writes } = deps.values()

    return stored === undefined ? undefined : writes.elsewhere(stored)
  }

  return setup({
    types: {
      context: {} as ShellContext,
      events: {} as ShellEvent,
      emitted: {} as ShellEmitted,
    },
    actors: {
      'platform.sign-out': fromPromise<unknown>(() => settled(deps.signOutHere())),
      // The page unloads as it loads again; the outcome is seen only if it did not.
      'platform.reload': fromPromise<void>(async () => deps.reload()),
      'platform.install.prompt': fromPromise<void>(() => deps.install.prompt()),
      'platform.install.postpone': fromPromise<void>(async () => deps.install.postpone()),
    },
    guards: {
      signedOut: () => deps.values().account === undefined,
      storedElsewhere: () => storedElsewhere() !== undefined,
      protocolTaken: ({ context }) => context.pending?.code !== 'protocol-outdated',
      quietReload: ({ context }) =>
        context.pending !== undefined &&
        !deps.values().unsaved &&
        !deps.selfReloads.done(context.pending.update),
    },
    actions: {
      show: emit((_, params: ShowParams) => ({ type: 'show' as const, ...params })),
      clear: emit((_, params: ClearParams) => ({ type: 'clear' as const, ...params })),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
      speakChoice: emit(({ event }) => {
        assertEvent(event, 'app-shell.locale-select')

        return { type: 'speak' as const, locale: event.locale }
      }),
      applyTheme: ({ event }) => {
        assertEvent(event, 'app-shell.theme-select')
        deps.setTheme(event.theme)
      },
      noteVersion: assign({
        pending: ({ event }) => {
          assertEvent(event, 'platform.new-version')

          return { code: 'new-version', update: event.served } as const
        },
      }),
      noteProtocol: assign({
        pending: () => ({ code: 'protocol-outdated', update: 'protocol' }) as const,
      }),
      // Taken under the guard quietReload, so an update waits.
      markSelfReload: ({ context }) => {
        if (context.pending !== undefined) {
          deps.selfReloads.mark(context.pending.update)
        }
      },
      // Taken under the guard storedElsewhere, so the language is there to speak.
      speakStored: enqueueActions(({ enqueue }) => {
        const locale = storedElsewhere()

        if (locale !== undefined) {
          enqueue.emit({ type: 'speak', locale })
        }
      }),
    },
  }).createMachine({
    context: { pending: undefined },
    initial: 'opening',
    states: {
      opening: {
        on: {
          'platform.opened': { target: 'ready' },
          'platform.open-failed': { target: 'failed' },
          'platform.storage-blocked': { target: 'storage-blocked' },
          'app-shell.locale-select': { target: 'opening', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
        },
      },
      ready: {
        on: {
          'app-shell.locale-select': [
            { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
          ],
          'app-shell.theme-select': THEME_CHOSEN,
          'model.settings.locale': { guard: 'storedElsewhere', actions: 'speakStored' },
          'platform.signed-out': SIGNED_OUT,
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
          'platform.crashed': { target: 'crashed' },
          'platform.new-version': NEW_VERSION,
          'platform.protocol-refused': PROTOCOL_OUTDATED,
          'app-shell.update-button': { target: 'updating' },
          'platform.tab-hidden': {
            target: 'updating',
            guard: 'quietReload',
            actions: 'markSelfReload',
          },
          ...SYNC,
          'platform.install-offered': INSTALL_AVAILABLE,
          'platform.install-by-steps': INSTALL_BY_STEPS,
          'platform.installed': { actions: INSTALL_GONE },
          'app-shell.install-button': { target: 'installing' },
          'app-shell.install-later-button': { target: 'postponing' },
        },
      },
      crashed: {
        entry: CRASHED,
        exit: CRASH_GONE,
        on: {
          'app-shell.reload-button': { target: 'reloading' },
          'platform.navigated': { target: 'ready' },
          'app-shell.locale-select': [
            { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
          ],
          'app-shell.theme-select': THEME_CHOSEN,
          'model.settings.locale': { guard: 'storedElsewhere', actions: 'speakStored' },
          'platform.signed-out': SIGNED_OUT,
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
          'platform.new-version': NEW_VERSION,
          'platform.protocol-refused': PROTOCOL_OUTDATED,
          'app-shell.update-button': { target: 'reloading' },
          'platform.tab-hidden': {
            target: 'reloading',
            guard: 'quietReload',
            actions: 'markSelfReload',
          },
          ...SYNC,
        },
      },
      reloading: {
        invoke: { src: 'platform.reload', onDone: { target: 'crashed' } },
      },
      updating: {
        invoke: { src: 'platform.reload', onDone: { target: 'ready' } },
      },
      installing: {
        invoke: {
          src: 'platform.install.prompt',
          onDone: { target: 'ready', actions: INSTALL_GONE },
          onError: { target: 'ready', actions: INSTALL_GONE },
        },
      },
      postponing: {
        invoke: {
          src: 'platform.install.postpone',
          onDone: { target: 'ready', actions: INSTALL_GONE },
        },
      },
      failed: {
        on: {
          'app-shell.sign-out-here-button': { target: 'signing-out' },
          'app-shell.locale-select': { target: 'failed', actions: 'speakChoice' },
          'app-shell.theme-select': THEME_CHOSEN,
        },
      },
      'signing-out': {
        invoke: {
          src: 'platform.sign-out',
          onDone: { target: 'signed-out', actions: TO_SIGN_IN },
          onError: { target: 'signed-out', actions: TO_SIGN_IN },
        },
      },
      'storage-blocked': { type: 'final' },
      'signed-out': { type: 'final' },
    },
  })
}
