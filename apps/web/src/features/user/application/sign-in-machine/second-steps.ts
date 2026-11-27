import { assertEvent } from 'xstate'

import type { SignInContext } from './context'
import { CODE_ERROR, CODE_INPUT } from './context'
import { askPastTheLimit, clearError, showError, welcomed } from './effects'
import type { SignInEvent } from './events'
import type { CodeAttempt, PasskeyAttempt } from './sign-in-actors'

const clearCodeInput = { type: 'clear', params: { anchor: CODE_INPUT } } as const
const clearCodeError = { type: 'clear', params: { anchor: CODE_ERROR } } as const
const showCodeError = {
  type: 'show',
  params: { anchor: CODE_ERROR, codes: ['invalid-code', 'failed'] },
} as const

/** What a state of the code step renders: the dialog and the input in it. */
const RENDERS_CODE = {
  renders: ['user.sign-in.forgot-link', 'user.sign-in.code.dialog', 'user.sign-in.code.code-input'],
} as const

/** The code the dialog's confirmation sent, for the step the password step asked for. */
function codeInput(
  { context, event }: { readonly context: SignInContext; readonly event: SignInEvent },
  signOutOldest: boolean,
): CodeAttempt {
  assertEvent(event, 'user.sign-in.code.dialog.confirm-button')

  return { step: context.step, code: event.code, signOutOldest }
}

/** The passkey sign-in the confirmation of its dialog asks for: it names the account the dialog asked about. */
function consentedInput({ context }: { readonly context: SignInContext }): PasskeyAttempt {
  return { signOutOldestFor: context.consentFor }
}

/** The cancel of the dialog of the code: the sign-in starts again from the password. */
const CANCEL_CODE = {
  target: 'sign-in',
  actions: [clearCodeInput, clearCodeError, 'forgetSteps'],
} as const

/**
 * A refused code. One that ends the step (it is over, or the account cannot sign in now) starts
 * again from the password, the reason on the form and the challenge dropped; any other shows in
 * the dialog under the field, which stays for another code.
 */
const refusedCode = (dialog: 'code' | 'code-anyway') =>
  [
    {
      target: 'sign-in',
      guard: 'codeStepEnded',
      actions: [
        clearCodeInput,
        'forgetSteps',
        showError('code-expired', 'account-banned', 'rate-limited', 'other-account'),
      ],
    },
    { target: dialog, actions: [showCodeError] },
  ] as const

/** A refused passkey sign-in goes back to the form with its reason, forgetting the account its dialog asked about. */
const REFUSED_PASSKEY = {
  target: 'sign-in',
  actions: [
    'forgetSteps',
    showError('passkey-cancelled', 'passkey-unknown', 'account-banned', 'other-account', 'failed'),
  ],
} as const

/**
 * The states of the second steps of a sign-in. The code step: the dialog asks the code once the
 * password step found the account's second factor on, its confirmation signs in, and a sign-in
 * past the limit of devices asks again from the password (`code-anyway`). The passkey sign-in asks
 * no password and no code, and has its own dialog past the limit of devices.
 */
export const SECOND_STEPS = {
  code: {
    meta: RENDERS_CODE,
    on: {
      'user.sign-in.code.dialog.confirm-button': { target: 'confirming-code' },
      'user.sign-in.code.dialog.cancel-button': CANCEL_CODE,
    },
  },
  'confirming-code': {
    meta: RENDERS_CODE,
    entry: [clearCodeError],
    invoke: {
      src: 'platform.confirm-sign-in',
      input: (args: { readonly context: SignInContext; readonly event: SignInEvent }) =>
        codeInput(args, false),
      onDone: { target: 'done', actions: ['keepOutcome', clearCodeInput, ...welcomed] },
      onError: [
        {
          target: 'device-limit',
          guard: 'atDeviceLimit',
          actions: ['keepOutcome', clearCodeInput, askPastTheLimit],
        },
        ...refusedCode('code'),
      ],
    },
  },
  'code-anyway': {
    meta: RENDERS_CODE,
    // The retry that asked the code is over: its form is no longer held.
    entry: ['forgetAttempt'],
    on: {
      'user.sign-in.code.dialog.confirm-button': { target: 'confirming-code-anyway' },
      'user.sign-in.code.dialog.cancel-button': CANCEL_CODE,
    },
  },
  'confirming-code-anyway': {
    meta: RENDERS_CODE,
    entry: [clearCodeError],
    invoke: {
      src: 'platform.confirm-sign-in',
      input: (args: { readonly context: SignInContext; readonly event: SignInEvent }) =>
        codeInput(args, true),
      onDone: { target: 'done', actions: ['keepOutcome', clearCodeInput, ...welcomed] },
      onError: refusedCode('code-anyway'),
    },
  },
  'signing-in-passkey': {
    meta: { renders: ['user.sign-in.forgot-link', 'user.sign-in.passkey-button'] },
    entry: [clearError],
    invoke: {
      src: 'platform.sign-in-passkey',
      input: { signOutOldestFor: undefined },
      onDone: { target: 'done', actions: welcomed },
      onError: [
        {
          target: 'passkey-device-limit',
          guard: 'atDeviceLimit',
          actions: ['keepOutcome', askPastTheLimit],
        },
        REFUSED_PASSKEY,
      ],
    },
  },
  // Nothing is signed in unless the dialog is confirmed, which asks for the passkey again.
  'passkey-device-limit': {
    meta: {
      renders: [
        'user.sign-in.forgot-link',
        'user.sign-in.passkey-button',
        'user.sign-in.device-limit-dialog',
      ],
    },
    on: {
      'user.sign-in.device-limit-dialog.confirm-button': { target: 'signing-in-passkey-anyway' },
      'user.sign-in.device-limit-dialog.cancel-button': {
        target: 'sign-in',
        actions: ['forgetSteps'],
      },
    },
  },
  'signing-in-passkey-anyway': {
    meta: { renders: ['user.sign-in.forgot-link', 'user.sign-in.passkey-button'] },
    invoke: {
      src: 'platform.sign-in-passkey',
      input: consentedInput,
      onDone: { target: 'done', actions: ['keepOutcome', ...welcomed] },
      onError: [
        // A passkey of another account at its limit too: the dialog asks about that account.
        {
          target: 'passkey-device-limit',
          guard: 'atDeviceLimit',
          actions: ['keepOutcome', askPastTheLimit],
        },
        REFUSED_PASSKEY,
      ],
    },
  },
} as const
