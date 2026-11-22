import { assertEvent } from 'xstate'

import { TWO_FACTOR_ERROR, TWO_FACTOR_SECTION } from './anchors'
import type { SettingsContext, SettingsEvent } from './events'
import type { Confirmation } from './two-factor-actors'

const PASSWORD_INPUT = 'user.settings.two-factor.password-input'
const CODE_INPUT = 'user.settings.two-factor.code-input'

/** What the states that ask for the password render: the password and the three presses it confirms. */
const PASSWORD_STEP = {
  renders: [
    PASSWORD_INPUT,
    'user.settings.two-factor.enable-button',
    'user.settings.two-factor.disable-button',
    'user.settings.two-factor.renew-codes-button',
  ],
} as const

/** What the states that wait for a code of the key render. */
const KEY_STEP = {
  renders: [
    'user.settings.two-factor.key-cell',
    CODE_INPUT,
    'user.settings.two-factor.confirm-button',
    'user.settings.two-factor.stop-button',
  ],
} as const

/** The password a press sent, which confirms the request. */
function passwordInput({ event }: { readonly event: SettingsEvent }): {
  readonly password: string
} {
  assertEvent(event, [
    'user.settings.two-factor.enable-button',
    'user.settings.two-factor.disable-button',
    'user.settings.two-factor.renew-codes-button',
  ])

  return { password: event.password }
}

/** The code the confirmation sent, with the enrolment of the key waiting for it. */
function confirmation({
  context,
  event,
}: {
  readonly context: SettingsContext
  readonly event: SettingsEvent
}): Confirmation {
  assertEvent(event, 'user.settings.two-factor.confirm-button')

  return { code: event.code, enrolment: context.start?.enrolment }
}

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: TWO_FACTOR_ERROR, codes } }) as const
const clearError = { type: 'clear', params: { anchor: TWO_FACTOR_ERROR } } as const
const clearField = (anchor: string) => ({ type: 'clear', params: { anchor } }) as const
const readSection = { type: 'read', params: { anchor: TWO_FACTOR_SECTION } } as const
const toast = (code: string) =>
  ({ type: 'show', params: { anchor: 'app-shell.toast', codes: [code] } }) as const

/** The refusals of a request that confirms the password, and the codes that name each. */
const PASSWORD_REFUSALS = ['invalid-credentials', 'rate-limited', 'failed'] as const

/**
 * The region of the screen's flow that turns the account's second factor on or off and renews its
 * backup codes, each request confirmed by the password typed. Turning it on asks a key first
 * (`enabling`), which shows (`confirming`) with its QR until a code of it (`turning-on`) turns the
 * factor on and shows the ten backup codes the start made (`codes`), once; the factor stays off
 * while the key waits, and stopping drops the key. A request that finds the factor changed
 * meanwhile (`factorChanged`, from another device) empties what it was sent with and reads the
 * section as it is now. Whatever secret the region held (the key, the codes) is dropped as it
 * comes back to `idle`.
 */
export const TWO_FACTOR_REGION = {
  initial: 'idle',
  states: {
    idle: {
      meta: PASSWORD_STEP,
      entry: ['dropSecrets'],
      on: {
        'user.settings.two-factor.enable-button': { target: 'enabling' },
        'user.settings.two-factor.disable-button': { target: 'disabling' },
        'user.settings.two-factor.renew-codes-button': { target: 'renewing' },
      },
    },
    enabling: {
      meta: PASSWORD_STEP,
      entry: [clearError],
      invoke: {
        src: 'platform.two-factor.enable',
        input: passwordInput,
        onDone: {
          target: 'confirming',
          actions: ['keepStart', clearField(PASSWORD_INPUT)],
        },
        onError: [
          {
            target: 'idle',
            guard: 'factorChanged',
            actions: [showError('two-factor-changed'), clearField(PASSWORD_INPUT), readSection],
          },
          { target: 'idle', actions: [showError(...PASSWORD_REFUSALS)] },
        ],
      },
    },
    confirming: {
      meta: KEY_STEP,
      on: {
        'user.settings.two-factor.confirm-button': { target: 'turning-on' },
        'user.settings.two-factor.stop-button': {
          target: 'idle',
          actions: [clearField(CODE_INPUT), clearError],
        },
      },
    },
    'turning-on': {
      meta: KEY_STEP,
      entry: [clearError],
      invoke: {
        src: 'platform.two-factor.confirm',
        input: confirmation,
        onDone: {
          target: 'codes',
          actions: [
            'showStartedCodes',
            clearField(CODE_INPUT),
            readSection,
            toast('two-factor-enabled'),
          ],
        },
        onError: [
          {
            target: 'idle',
            guard: 'factorChanged',
            actions: [showError('two-factor-changed'), clearField(CODE_INPUT), readSection],
          },
          {
            target: 'confirming',
            actions: [showError('invalid-code', 'rate-limited', 'failed')],
          },
        ],
      },
    },
    codes: {
      meta: {
        renders: [
          'user.settings.two-factor.codes-cell',
          'user.settings.two-factor.hide-codes-button',
        ],
      },
      on: { 'user.settings.two-factor.hide-codes-button': { target: 'idle' } },
    },
    disabling: {
      meta: PASSWORD_STEP,
      entry: [clearError],
      invoke: {
        src: 'platform.two-factor.disable',
        input: passwordInput,
        onDone: {
          target: 'idle',
          actions: [clearField(PASSWORD_INPUT), readSection, toast('two-factor-disabled')],
        },
        onError: { target: 'idle', actions: [showError(...PASSWORD_REFUSALS)] },
      },
    },
    renewing: {
      meta: PASSWORD_STEP,
      entry: [clearError],
      invoke: {
        src: 'platform.two-factor.renew-codes',
        input: passwordInput,
        onDone: { target: 'codes', actions: ['keepRenewedCodes', clearField(PASSWORD_INPUT)] },
        onError: [
          {
            target: 'idle',
            guard: 'factorChanged',
            actions: [showError('two-factor-changed'), clearField(PASSWORD_INPUT), readSection],
          },
          { target: 'idle', actions: [showError(...PASSWORD_REFUSALS)] },
        ],
      },
    },
  },
} as const
