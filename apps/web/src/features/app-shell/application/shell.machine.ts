import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'

import type { LocaleWrites } from './locale-writes'

/** What the frame's guards read at the moment they are asked. */
export interface ShellValues {
  /** The account signed in on this device; none for a guest. */
  readonly account: string | undefined
  /** Moves on each time the account changes, a sign-out included: the same account back is not. */
  readonly session: number
  /** The session the store under way began in. */
  readonly storingIn: number | undefined
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
  | { readonly type: 'model.settings.locale' }
  | { readonly type: 'app-shell.sign-out-here-button' }
  | { readonly type: 'platform.signed-out' }

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
  /** Stores the language in the account's settings on this device. */
  readonly storeLocale: (locale: Locale) => ResultAsync<void, unknown>
  /** Signs the saved account out on this device, when its data did not open. */
  readonly signOutHere: () => ResultAsync<unknown, unknown>
}

/** A result that resolves once done, or rejects with its failure. */
async function settled<T>(result: ResultAsync<T, unknown>): Promise<T> {
  const outcome = await result

  return outcome.isOk() ? outcome.value : Promise.reject(outcome.error)
}

const NOT_STORED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['locale-not-stored'] },
} as const
const TO_SIGN_IN = { type: 'navigate', params: { to: '/sign-in' } } as const
/** The notice goes with the account that was signed in when it was raised. */
const CLEAR_NOTICE = { type: 'clear', params: { anchor: 'app-shell.notice-message' } } as const

/** The frame's flow (`contract/screens/__root.yaml`) as the app runs it. */
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
      'settings.updateLocale': fromPromise<void, { readonly locale: Locale }>(({ input }) =>
        settled(deps.storeLocale(input.locale)),
      ),
      'platform.sign-out': fromPromise<unknown>(() => settled(deps.signOutHere())),
    },
    guards: {
      settingsHeld: () => deps.values().stored !== undefined,
      signedOut: () => deps.values().account === undefined,
      accountLeft: () => {
        const { session, storingIn } = deps.values()

        return storingIn !== session
      },
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
        },
      },
      ready: {
        on: {
          'app-shell.locale-select': [
            { target: 'storing-locale', guard: 'settingsHeld', actions: 'speakChoice' },
            { target: 'ready', guard: 'signedOut', actions: 'speakChoice' },
          ],
          'model.settings.locale': { guard: 'storedElsewhere', actions: 'speakStored' },
          'platform.signed-out': { actions: CLEAR_NOTICE },
        },
      },
      'storing-locale': {
        on: {
          'model.settings.locale': { guard: 'storedElsewhere', actions: 'speakStored' },
          'platform.signed-out': { actions: CLEAR_NOTICE },
        },
        invoke: {
          src: 'settings.updateLocale',
          input: ({ event }) => {
            assertEvent(event, 'app-shell.locale-select')

            return { locale: event.locale }
          },
          onDone: { target: 'ready' },
          onError: [
            { target: 'ready', guard: 'accountLeft' },
            { target: 'ready', actions: NOT_STORED },
          ],
        },
      },
      failed: {
        on: {
          'app-shell.sign-out-here-button': { target: 'signing-out' },
          'app-shell.locale-select': { target: 'failed', actions: 'speakChoice' },
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
