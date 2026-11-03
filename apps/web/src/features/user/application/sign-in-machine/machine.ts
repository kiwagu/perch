import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../../platform/actor-outcome'
import type { SignInForm, SignInService } from '../sign-in.service'

import {
  CHECK_YOUR_MAIL,
  MAIL_MESSAGE,
  PASSWORDS_DIFFER,
  SIGN_IN_ERROR,
  type SignInContext,
  UNKNOWN_FAILURE,
} from './context'
import type { ClearParams, NavigateParams, ShowParams, SignInEmitted, SignInEvent } from './events'
import { signInGuards } from './guards'

/** The form the submit button sent, which a sign-in or a sign-up takes. */
function formInput({ event }: { readonly event: SignInEvent }): { readonly form: SignInForm } {
  assertEvent(event, 'user.sign-in.submit-button')

  return { form: event.form }
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
        to: '/forgot-password',
        search: { email: { anchor: 'user.sign-in.email-input' } },
      },
    },
  ],
} as const

/** The effect showing the form's error: its one code, or the code of the failure among `codes`. */
const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: SIGN_IN_ERROR, codes } }) as const
const clearError = { type: 'clear', params: { anchor: SIGN_IN_ERROR } } as const
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
 * asking to check the mail, and a sign-in of an account not verified yet offers the resend. At
 * sign-up the password is held to the rules of a new password and the password typed again is
 * compared, as either is typed and on the switch into sign-up, and the submit is held while the
 * password breaks a rule or the two differ. In the mode sign-in the forgot-link moves to the page
 * that asks for a reset mail, carrying the email typed. Its `show` and `clear` keep the codes of
 * the form's own error and mail message for the view and emit any other; its `navigate` emits the
 * path with the fields its event carries, for the host to move with.
 */
export function createSignInMachine(service: Pick<SignInService, 'signIn' | 'signUp' | 'resend'>) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
      emitted: {} as SignInEmitted,
    },
    guards: signInGuards,
    actors: {
      'platform.sign-in': fromPromise(
        ({ input }: { readonly input: { readonly form: SignInForm } }) =>
          settled(service.signIn(input.form)),
      ),
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
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === SIGN_IN_ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === MAIL_MESSAGE) {
          enqueue.assign({ mail: undefined, sentTo: undefined })
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
    },
  }).createMachine({
    id: 'user.sign-in',
    initial: 'sign-in',
    context: { error: undefined, mail: undefined, sentTo: undefined },
    states: {
      'sign-in': {
        on: {
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.toggle-button': intoSignUp(clearError),
          'user.sign-in.submit-button': { target: 'signing-in' },
        },
      },
      'sign-up': {
        on: {
          'user.sign-in.toggle-button': { target: 'sign-in', actions: [clearError] },
          'user.sign-in.password-confirmation-input': {
            target: 'passwords-differ',
            guard: 'confirmationStrays',
          },
          'user.sign-in.password-input': [
            { target: 'password-weak', guard: 'passwordBreaksRules' },
            { target: 'passwords-differ', guard: 'confirmationStrays' },
          ],
          'user.sign-in.submit-button': [
            { target: 'passwords-differ', guard: 'passwordsDiffer' },
            { target: 'signing-up' },
          ],
        },
      },
      // The list marks the rules the password keeps; the password typed again waits to be judged,
      // and the submit is not taken.
      'password-weak': {
        on: {
          'user.sign-in.password-input': [
            { guard: 'passwordBreaksRules' },
            { target: 'passwords-differ', guard: 'confirmationStrays' },
            { target: 'sign-up' },
          ],
          'user.sign-in.toggle-button': { target: 'sign-in', actions: [clearError] },
        },
      },
      'passwords-differ': {
        entry: [showError('passwords-differ')],
        exit: [clearError],
        on: {
          'user.sign-in.password-confirmation-input': {
            target: 'sign-up',
            guard: 'confirmationFollows',
          },
          'user.sign-in.password-input': [
            { target: 'password-weak', guard: 'passwordBreaksRules' },
            { target: 'sign-up', guard: 'confirmationFollows' },
          ],
          'user.sign-in.toggle-button': { target: 'sign-in' },
        },
      },
      'signing-in': {
        entry: [clearError],
        invoke: {
          src: 'platform.sign-in',
          input: formInput,
          onDone: {
            target: 'done',
            actions: [
              { type: 'show', params: { anchor: 'app-shell.notice-message', codes: ['welcome'] } },
              { type: 'navigate', params: { to: '/me' } },
            ],
          },
          onError: [
            {
              target: 'unverified',
              guard: 'emailNotVerified',
              actions: [showError('email-not-verified')],
            },
            {
              target: 'sign-in',
              actions: [
                showError('invalid-credentials', 'rate-limited', 'other-account', 'failed'),
              ],
            },
          ],
        },
      },
      'signing-up': {
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
        on: {
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in', actions: [clearMail] },
          'user.sign-in.toggle-button': intoSignUp(clearMail),
        },
      },
      unverified: {
        on: {
          'user.sign-in.forgot-link': toForgotPassword,
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in' },
          'user.sign-in.toggle-button': intoSignUp(clearError),
        },
      },
      resending: {
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
      done: { type: 'final' },
      'forgot-password': { type: 'final' },
    },
  })
}
