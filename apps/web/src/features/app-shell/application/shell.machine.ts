import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, enqueueActions, fromPromise, setup } from 'xstate'

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
}

/** A result that resolves once done, or rejects with its failure. */
async function settled<T>(result: ResultAsync<T, unknown>): Promise<T> {
  const outcome = await result

  return outcome.isOk() ? outcome.value : Promise.reject(outcome.error)
}

const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const
/** The notice goes with the account that was signed in when it was raised. */
const CLEAR_NOTICE = { type: 'clear', params: { anchor: 'app-shell.notice-message' } } as const
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

/** The frame's flow (`contract/domain/screens/__root.yaml`) as the app runs it. */
export function createShellMachine(deps: ShellMachineDeps) {
  /** The stored language, when another device stored it and this one has not seen it yet. */
  const storedElsewhere = (): Locale | undefined => {
    const { stored, writes } = deps.values()

    return stored === undefined ? undefined : writes.elsewhere(stored)
  }

  return setup({
    types: {
      events: {} as ShellEvent,
      emitted: {} as ShellEmitted,
    },
    actors: {
      'platform.sign-out': fromPromise<unknown>(() => settled(deps.signOutHere())),
      // The page unloads as it loads again; the outcome is seen only if it did not.
      'platform.reload': fromPromise<void>(async () => deps.reload()),
    },
    guards: {
      signedOut: () => deps.values().account === undefined,
      storedElsewhere: () => storedElsewhere() !== undefined,
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
      // Taken under the guard storedElsewhere, so the language is there to speak.
      speakStored: enqueueActions(({ enqueue }) => {
        const locale = storedElsewhere()

        if (locale !== undefined) {
          enqueue.emit({ type: 'speak', locale })
        }
      }),
    },
  }).createMachine({
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
          'platform.signed-out': { actions: CLEAR_NOTICE },
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
          'platform.crashed': { target: 'crashed' },
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
          'platform.signed-out': { actions: CLEAR_NOTICE },
          'platform.change-rejected': { actions: REJECTED },
          'platform.changes-reloaded': { actions: RELOADED },
        },
      },
      reloading: {
        invoke: { src: 'platform.reload', onDone: { target: 'crashed' } },
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
