import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'

import type { Theme } from '../../../../platform/theme'

/** What the screen's guards read at the moment they are asked. */
export interface SettingsValues {
  /** The account's settings are on this device. */
  readonly held: boolean
  /** The account signed in on this device; none once it signed out. */
  readonly account: string | undefined
  /** The account the store under way began for. */
  readonly storingFor: string | undefined
}

export type SettingsEvent =
  | { readonly type: 'user.settings.theme-select'; readonly theme: Theme }
  | { readonly type: 'user.settings.locale-select'; readonly locale: Locale }

interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

/** The flow's effect on the frame's notice, and the language the app is to speak. */
export type SettingsEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | { readonly type: 'speak'; readonly locale: Locale }

export interface SettingsMachineDeps {
  readonly values: () => SettingsValues
  /** Shows a theme on this device and keeps it there. */
  readonly setTheme: (theme: Theme) => void
  /** Stores the language in the account's settings. */
  readonly storeLocale: (locale: Locale) => ResultAsync<void, unknown>
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

/** The settings screen's flow (`contract/domain/screens/settings.yaml`) as the app runs it. */
export function createSettingsMachine(deps: SettingsMachineDeps) {
  return setup({
    types: {
      events: {} as SettingsEvent,
      emitted: {} as SettingsEmitted,
    },
    actors: {
      'platform.theme.set': fromPromise<void, { readonly theme: Theme }>(async ({ input }) =>
        deps.setTheme(input.theme),
      ),
      'settings.updateLocale': fromPromise<void, { readonly locale: Locale }>(({ input }) =>
        settled(deps.storeLocale(input.locale)),
      ),
    },
    guards: {
      settingsHeld: () => deps.values().held,
      accountLeft: () => {
        const { account, storingFor } = deps.values()

        return account !== storingFor
      },
    },
    actions: {
      show: emit((_, params: ShowParams) => ({ type: 'show' as const, ...params })),
      speakChoice: emit(({ event }) => {
        assertEvent(event, 'user.settings.locale-select')

        return { type: 'speak' as const, locale: event.locale }
      }),
    },
  }).createMachine({
    id: 'settings',
    initial: 'viewing',
    states: {
      viewing: {
        type: 'parallel',
        states: {
          theme: {
            initial: 'idle',
            states: {
              idle: {
                on: { 'user.settings.theme-select': { target: 'applying' } },
              },
              applying: {
                invoke: {
                  src: 'platform.theme.set',
                  input: ({ event }) => {
                    assertEvent(event, 'user.settings.theme-select')

                    return { theme: event.theme }
                  },
                  onDone: { target: 'idle' },
                },
              },
            },
          },
          language: {
            initial: 'idle',
            states: {
              idle: {
                on: {
                  'user.settings.locale-select': {
                    target: 'storing',
                    guard: 'settingsHeld',
                    actions: 'speakChoice',
                  },
                },
              },
              storing: {
                invoke: {
                  src: 'settings.updateLocale',
                  input: ({ event }) => {
                    assertEvent(event, 'user.settings.locale-select')

                    return { locale: event.locale }
                  },
                  onDone: { target: 'idle' },
                  onError: [
                    { target: 'idle', guard: 'accountLeft' },
                    { target: 'idle', actions: NOT_STORED },
                  ],
                },
              },
            },
          },
        },
      },
    },
  })
}
