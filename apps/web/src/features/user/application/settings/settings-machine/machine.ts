import { assertEvent, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'

import { failureOf, settled } from '../../../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../../../platform/flow-effects'
import type { Theme } from '../../../../../platform/theme'

import { EMAIL_ERROR, EMAIL_MESSAGE, PASSWORD_ERROR, SETTINGS_PASSWORDS_DIFFER } from './anchors'
import { EMAIL_REGION } from './email-region'
import type { SettingsContext, SettingsEmitted, SettingsEvent, SettingsMachineDeps } from './events'
import { settingsGuards } from './guards'
import { PASSWORD_REGION } from './password-region'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'settings:UNKNOWN'

const THEME_NOT_STORED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['theme-not-stored'] },
} as const

const LOCALE_NOT_STORED = {
  type: 'show',
  params: { anchor: 'app-shell.notice-message', codes: ['locale-not-stored'] },
} as const

/**
 * The settings screen's flow as the app runs it: the theme, the language, the password and the
 * email are regions of one parallel state. Its `show`
 * and `clear` keep the codes of the password form's error and of the email form's error and
 * message for the view, and emit the rest: a code on the frame, a field to empty.
 */
export function createSettingsMachine(deps: SettingsMachineDeps) {
  return setup({
    types: {
      context: {} as SettingsContext,
      events: {} as SettingsEvent,
      emitted: {} as SettingsEmitted,
    },
    actors: {
      'settings.updateTheme': fromPromise<void, { readonly theme: Theme }>(({ input }) =>
        settled(deps.storeTheme(input.theme)),
      ),
      'settings.updateLocale': fromPromise<void, { readonly locale: Locale }>(({ input }) =>
        settled(deps.storeLocale(input.locale)),
      ),
      'platform.change-password': fromPromise<
        void,
        { readonly currentPassword: string; readonly password: string }
      >(({ input }) => settled(deps.changePassword(input.currentPassword, input.password))),
      // It ends with the new email it sent to: the message names that one, not the field's.
      'platform.change-email': fromPromise<
        string,
        { readonly email: string; readonly password: string }
      >(({ input }) =>
        settled(deps.changeEmail(input.email, input.password)).then(() => input.email),
      ),
    },
    guards: settingsGuards(deps),
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === PASSWORD_ERROR) {
          // The form finds the passwords differ itself; any other code is the failure's.
          enqueue.assign({
            passwordError: params.codes.includes('passwords-differ')
              ? SETTINGS_PASSWORDS_DIFFER
              : failureOf(event, UNKNOWN_FAILURE),
          })
        } else if (params.anchor === EMAIL_ERROR) {
          enqueue.assign({ emailError: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === EMAIL_MESSAGE) {
          enqueue.assign({
            emailMessage: params.codes.includes('check-your-mail') ? 'check-your-mail' : undefined,
            sentTo:
              'output' in event && typeof event.output === 'string' ? event.output : undefined,
          })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      // An anchor that carries codes shows none; a field is emptied by the host.
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === PASSWORD_ERROR) {
          enqueue.assign({ passwordError: undefined })
        } else if (params.anchor === EMAIL_ERROR) {
          enqueue.assign({ emailError: undefined })
        } else if (params.anchor === EMAIL_MESSAGE) {
          enqueue.assign({ emailMessage: undefined, sentTo: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      // The chosen theme shows at once, while its store runs.
      showChoice: ({ event }) => {
        assertEvent(event, 'user.settings.theme-select')
        deps.setTheme(event.theme)
      },
      speakChoice: emit(({ event }) => {
        assertEvent(event, 'user.settings.locale-select')

        return { type: 'speak' as const, locale: event.locale }
      }),
    },
  }).createMachine({
    id: 'settings',
    initial: 'viewing',
    context: {
      passwordError: undefined,
      emailError: undefined,
      emailMessage: undefined,
      sentTo: undefined,
    },
    states: {
      viewing: {
        type: 'parallel',
        states: {
          theme: {
            initial: 'idle',
            states: {
              idle: {
                on: {
                  'user.settings.theme-select': {
                    target: 'storing',
                    guard: 'settingsHeld',
                    actions: 'showChoice',
                  },
                },
              },
              storing: {
                invoke: {
                  src: 'settings.updateTheme',
                  input: ({ event }) => {
                    assertEvent(event, 'user.settings.theme-select')

                    return { theme: event.theme }
                  },
                  onDone: { target: 'idle' },
                  onError: [
                    { target: 'idle', guard: 'accountLeft' },
                    { target: 'idle', actions: THEME_NOT_STORED },
                  ],
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
                    { target: 'idle', actions: LOCALE_NOT_STORED },
                  ],
                },
              },
            },
          },
          password: PASSWORD_REGION,
          email: EMAIL_REGION,
        },
      },
    },
  })
}
