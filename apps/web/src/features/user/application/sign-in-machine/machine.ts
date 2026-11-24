import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import { CONTRACT_ROUTES } from '@workspace/kernel'

import { failureOf, settled } from '../../../../platform/actor-outcome'
import type { SignInForm, SignInService } from '../sign-in.service'

import {
  CHECK_YOUR_MAIL,
  CODE_ERROR,
  MAIL_MESSAGE,
  PASSWORDS_DIFFER,
  SIGN_IN_ERROR,
  type SignInContext,
  UNKNOWN_FAILURE,
} from './context'
import { DEVICE_LIMIT_STATES } from './device-limit-states'
import { askCode, askPastTheLimit, clearError, refusedSignIn, showError, welcomed } from './effects'
import type { ClearParams, NavigateParams, ShowParams, SignInEmitted, SignInEvent } from './events'
import { signInGuards } from './guards'
import { outcomeOf } from './outcome'
import { SECOND_STEPS } from './second-steps'
import { type SignInAttempt, signInActors } from './sign-in-actors'
import { SIGN_UP_STATES } from './sign-up-states'

/** The form the submit button sent, which a sign-in or a sign-up takes. */
function formInput({ event }: { readonly event: SignInEvent }): { readonly form: SignInForm } {
  assertEvent(event, 'user.sign-in.submit-button')

  return { form: event.form }
}

/** The sign-in the submit button asks for. */
function signInInput({ event }: { readonly event: SignInEvent }): SignInAttempt {
  assertEvent(event, 'user.sign-in.submit-button')

  return { form: event.form, signOutOldest: false }
}

/** The email the resend button sent, which the resend takes. */
function emailInput({ event }: { readonly event: SignInEvent }): { readonly email: string } {
  assertEvent(event, 'user.sign-in.resend-button')

  return { email: event.email }
}

/** The move to the page that asks for a reset mail, carrying the email typed. */
const toForgotPassword = {
  target: 'forgot-password',
  actions: [
    {
      type: 'navigate',
      params: {
        to: CONTRACT_ROUTES['user.forgot-password'],
        search: { email: { anchor: 'user.sign-in.email-input' } },
      },
    },
  ],
} as const

const clearMail = { type: 'clear', params: { anchor: MAIL_MESSAGE } } as const
const showMail = {
  type: 'show',
  params: { anchor: MAIL_MESSAGE, codes: [CHECK_YOUR_MAIL] },
} as const

/**
 * The switch into the mode sign-up, judging the passwords as typed with `clear` on the way: to
 * `password-weak` while the password breaks a rule, else to `passwords-differ` while the password
 * typed again strayed, else to `sign-up`.
 */
const intoSignUp = (clear: typeof clearError | typeof clearMail) =>
  [
    { target: 'password-weak', guard: 'passwordBreaksRules', actions: [clear] },
    { target: 'passwords-differ', guard: 'confirmationStrays', actions: [clear] },
    { target: 'sign-up', actions: [clear] },
  ] as const

/**
 * The sign-in form as the screen's flow says (`contract/domain/screens/sign-in.yaml`): the mode is
 * the state, an attempt is an invoke of its platform action, a failure goes back to the mode with
 * its code; a sign-up, or a resend of the verification mail, leaves the form in the mode sign-in
 * asking to check the mail, and a sign-in of an account not verified yet offers the resend. A
 * sign-in that finds the account signed in on as many devices as it may be signs nothing in and
 * asks in its dialog; confirmed, it signs in all the same, signing out the account's device seen
 * least recently, and the cancel goes back to the form. A sign-in of an account whose second
 * factor is on asks a code in its dialog once the password is right, and signs in when the code
 * is taken (`second-steps.ts`); a passkey signs in with no password and no code, from every state
 * that offers its button. At
 * sign-up the password is held to the rules of a new password and the password typed again is
 * compared, as either is typed and on the switch into sign-up, and the submit is held while the
 * password breaks a rule or the two differ. In the mode sign-in the forgot-link moves to the page
 * that asks for a reset mail, carrying the email typed. Its `show` and `clear` keep the codes of
 * the form's own error and mail message for the view and emit any other; its `navigate` emits the
 * path with the fields its event carries, for the host to move with.
 */
export function createSignInMachine(
  service: Pick<
    SignInService,
    'signIn' | 'signUp' | 'resend' | 'confirmSignIn' | 'signInWithPasskey'
  >,
) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
      emitted: {} as SignInEmitted,
    },
    guards: signInGuards,
    actors: {
      // A sign-up and a resend end with the address they mailed: the message names that one, not
      // the field's, which can change after.
      'platform.sign-up': fromPromise(
        ({ input }: { readonly input: { readonly form: SignInForm } }) =>
          settled(service.signUp(input.form).map(() => input.form.email)),
      ),
      'platform.resend-verification': fromPromise(
        ({ input }: { readonly input: { readonly email: string } }) =>
          settled(service.resend(input.email).map(() => input.email)),
      ),
      ...signInActors(service),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === SIGN_IN_ERROR) {
          // The form finds the passwords differ itself; any other code is the failure's.
          enqueue.assign({
            error: params.codes.includes('passwords-differ')
              ? PASSWORDS_DIFFER
              : failureOf(event, UNKNOWN_FAILURE),
          })
        } else if (params.anchor === MAIL_MESSAGE) {
          enqueue.assign({
            mail: params.codes.includes(CHECK_YOUR_MAIL) ? CHECK_YOUR_MAIL : undefined,
          })
        } else if (params.anchor === CODE_ERROR) {
          enqueue.assign({ codeError: failureOf(event, UNKNOWN_FAILURE) })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === SIGN_IN_ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === MAIL_MESSAGE) {
          enqueue.assign({ mail: undefined, sentTo: undefined })
        } else if (params.anchor === CODE_ERROR) {
          enqueue.assign({ codeError: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      // The fields the event carries go with the move: its search takes the email typed from them.
      navigate: emit(({ event }, params: NavigateParams) => ({
        type: 'navigate' as const,
        ...params,
        ...('fields' in event ? { fields: event.fields } : {}),
      })),
      // The code step and the account a passkey dialog asked about follow the last answer.
      keepOutcome: assign(({ event }) => {
        const outcome = outcomeOf(event)

        return {
          step:
            outcome?.kind === 'code-required'
              ? { challenge: outcome.challenge, email: outcome.email }
              : undefined,
          consentFor: outcome?.kind === 'device-limit' ? outcome.consentFor : undefined,
        }
      }),
      forgetSteps: assign({ step: undefined, consentFor: undefined }),
      // The attempt keeps the form it was sent with until it ends: the form's fields may change.
      holdAttempt: assign(({ event }) => {
        assertEvent(event, 'user.sign-in.submit-button')

        return { attempt: event.form }
      }),
      forgetAttempt: assign({ attempt: undefined }),
    },
  }).createMachine({
    id: 'user.sign-in',
    initial: 'sign-in',
    context: {
      error: undefined,
      mail: undefined,
      sentTo: undefined,
      step: undefined,
      attempt: undefined,
      codeError: undefined,
      consentFor: undefined,
    },
    states: {
      'sign-in': {
        meta: { renders: ['user.sign-in.forgot-link', 'user.sign-in.passkey-button'] },
        entry: ['forgetAttempt'],
        on: {
          'user.sign-in.passkey-button': { target: 'signing-in-passkey' },
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.toggle-button': intoSignUp(clearError),
          'user.sign-in.submit-button': { target: 'signing-in' },
        },
      },
      ...SIGN_UP_STATES,
      'signing-in': {
        meta: { renders: ['user.sign-in.forgot-link'] },
        entry: [clearError, 'holdAttempt'],
        invoke: {
          src: 'platform.sign-in',
          input: signInInput,
          onDone: [
            { target: 'code', guard: 'codeRequired', actions: ['keepOutcome', askCode] },
            { target: 'device-limit', guard: 'atDeviceLimit', actions: [askPastTheLimit] },
            { target: 'done', actions: welcomed },
          ],
          onError: refusedSignIn,
        },
      },
      ...DEVICE_LIMIT_STATES,
      ...SECOND_STEPS,
      'signing-up': {
        meta: {
          renders: [
            'user.sign-in.password-rule-list',
            'user.sign-in.password-confirmation-input',
            'user.sign-in.name-input',
          ],
        },
        entry: [clearError],
        invoke: {
          src: 'platform.sign-up',
          input: formInput,
          onDone: {
            target: 'check-mail',
            actions: [showMail, assign({ sentTo: ({ event }) => event.output })],
          },
          onError: {
            target: 'sign-up',
            actions: [
              showError(
                'sign-up-rejected',
                'rate-limited',
                'name-required',
                'name-too-long',
                'failed',
              ),
            ],
          },
        },
      },
      'check-mail': {
        meta: {
          renders: [
            'user.sign-in.forgot-link',
            'user.sign-in.resend-button',
            'user.sign-in.passkey-button',
          ],
        },
        on: {
          'user.sign-in.passkey-button': { target: 'signing-in-passkey', actions: [clearMail] },
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in', actions: [clearMail] },
          'user.sign-in.toggle-button': intoSignUp(clearMail),
        },
      },
      unverified: {
        meta: {
          renders: [
            'user.sign-in.forgot-link',
            'user.sign-in.resend-button',
            'user.sign-in.passkey-button',
          ],
        },
        entry: ['forgetAttempt'],
        on: {
          'user.sign-in.passkey-button': { target: 'signing-in-passkey' },
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in' },
          'user.sign-in.toggle-button': intoSignUp(clearError),
        },
      },
      resending: {
        meta: { renders: ['user.sign-in.forgot-link', 'user.sign-in.resend-button'] },
        entry: [clearError],
        invoke: {
          src: 'platform.resend-verification',
          input: emailInput,
          onDone: {
            target: 'check-mail',
            actions: [showMail, assign({ sentTo: ({ event }) => event.output })],
          },
          onError: {
            target: 'unverified',
            actions: [clearMail, showError('rate-limited', 'failed')],
          },
        },
      },
      done: {
        type: 'final',
        entry: ['forgetAttempt'],
        meta: { renders: ['user.sign-in.forgot-link'] },
      },
      'forgot-password': { type: 'final', meta: { renders: ['user.sign-in.forgot-link'] } },
    },
  })
}
