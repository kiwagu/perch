import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { Locale } from '@workspace/i18n'
import type { PasskeyId } from '@workspace/ids'

import { failureOf, settled } from '../../../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../../../platform/flow-effects'
import type { Theme } from '../../../../../platform/theme'

import {
  DELETION_ERROR,
  DELETION_MESSAGE,
  EMAIL_ERROR,
  EMAIL_MESSAGE,
  PASSKEYS_ERROR,
  PASSWORD_ERROR,
  SETTINGS_PASSWORDS_DIFFER,
  TWO_FACTOR_ERROR,
} from './anchors'
import { DELETION_REGION } from './deletion-region'
import { EMAIL_REGION } from './email-region'
import type {
  ReadParams,
  SettingsContext,
  SettingsEmitted,
  SettingsEvent,
  SettingsMachineDeps,
} from './events'
import { settingsGuards } from './guards'
import { PASSKEY_ADD_REGION, PASSKEY_REMOVE_REGION } from './passkeys-region'
import { PASSWORD_REGION } from './password-region'
import { twoFactorActors } from './two-factor-actors'
import { twoFactorOutputOf } from './two-factor-output'
import { TWO_FACTOR_REGION } from './two-factor-region'

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
 * The settings screen's flow as the app runs it: the theme, the language, the password, the email,
 * the second factor, the adding and the removing of a passkey and the account's deletion are
 * regions of one parallel state. Its `show` and `clear` keep the codes of the password form's
 * error, of the email form's error and message, of the second factor's error, of the passkeys'
 * error and of the deletion form's error and message for the view, and emit the rest: a code on
 * the frame, a field to empty. Its `read` asks the host to read a section or a list again. What
 * the second factor's key step and its backup codes show is kept in the context, until the region
 * comes back to rest.
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
      'platform.request-account-deletion': fromPromise<void, { readonly password: string }>(
        ({ input }) => settled(deps.requestAccountDeletion(input.password)),
      ),
      ...twoFactorActors(deps),
      'platform.passkeys.add': fromPromise<void>(() => settled(deps.addPasskey())),
      'platform.passkeys.remove': fromPromise<void, { readonly passkey: PasskeyId }>(({ input }) =>
        settled(deps.removePasskey(input.passkey)),
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
        } else if (params.anchor === DELETION_ERROR) {
          enqueue.assign({ deletionError: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === TWO_FACTOR_ERROR) {
          enqueue.assign({ twoFactorError: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === PASSKEYS_ERROR) {
          enqueue.assign({ passkeysError: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === DELETION_MESSAGE) {
          enqueue.assign({
            deletionMessage: params.codes.includes('check-your-mail')
              ? 'check-your-mail'
              : undefined,
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
        } else if (params.anchor === DELETION_ERROR) {
          enqueue.assign({ deletionError: undefined })
        } else if (params.anchor === TWO_FACTOR_ERROR) {
          enqueue.assign({ twoFactorError: undefined })
        } else if (params.anchor === PASSKEYS_ERROR) {
          enqueue.assign({ passkeysError: undefined })
        } else if (params.anchor === DELETION_MESSAGE) {
          enqueue.assign({ deletionMessage: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      read: emit((_, params: ReadParams) => ({ type: 'read' as const, ...params })),
      // The key step holds the start its turning on answered; the codes shown are the start's once
      // the key is confirmed, or those a renewal made; the region drops both as it comes to rest.
      keepStart: assign(({ event }) => {
        const output = twoFactorOutputOf(event)

        return { start: output?.kind === 'start' ? output.start : undefined }
      }),
      showStartedCodes: assign(({ context }) => ({
        backupCodes: context.start?.backupCodes,
        start: undefined,
      })),
      keepRenewedCodes: assign(({ event }) => {
        const output = twoFactorOutputOf(event)

        return { backupCodes: output?.kind === 'codes' ? output.backupCodes : undefined }
      }),
      dropSecrets: assign({ start: undefined, backupCodes: undefined }),
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
      deletionError: undefined,
      deletionMessage: undefined,
      twoFactorError: undefined,
      start: undefined,
      backupCodes: undefined,
      passkeysError: undefined,
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
          'two-factor': TWO_FACTOR_REGION,
          'passkey-add': PASSKEY_ADD_REGION,
          'passkey-remove': PASSKEY_REMOVE_REGION,
          deletion: DELETION_REGION,
        },
      },
    },
  })
}
