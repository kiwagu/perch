import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../platform/actor-outcome'
import {
  checkPasswordConfirmation,
  type PasswordConfirmation,
  type Passwords,
} from '../domain/password-confirmation.rule'

import type { SignInForm, SignInService } from './sign-in.service'

/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
const SIGN_IN_ERROR = 'user.sign-in.error'

/** The anchor of the message asking to open the verification mail: the machine keeps its code. */
const MAIL_MESSAGE = 'user.sign-in.mail-message'

/** The code the mail message shows. */
const CHECK_YOUR_MAIL = 'check-your-mail'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'sign-in:UNKNOWN'

/** The code the error keeps while the password typed again differs, which the form finds itself. */
const PASSWORDS_DIFFER = 'sign-in:PASSWORDS_DIFFER'

export interface SignInContext {
  /** The code of the last failure, cleared by the next attempt and by a switch of mode. */
  readonly error: string | undefined
  /** The code of the mail message, shown once a sign-up or a resend went through. */
  readonly mail: typeof CHECK_YOUR_MAIL | undefined
  /** The address the last sign-up or resend that went through mailed, which the message names. */
  readonly sentTo: string | undefined
}

/**
 * The events of the screen's flow: the user acts on these anchors. A keystroke in either password
 * carries both as typed; the submit, the password typed again beside the form, never sent with it.
 */
export type SignInEvent =
  | { readonly type: 'user.sign-in.toggle-button' }
  | {
      readonly type: 'user.sign-in.submit-button'
      readonly form: SignInForm
      readonly confirmation: string
    }
  | ({ readonly type: 'user.sign-in.password-input' } & Passwords)
  | ({ readonly type: 'user.sign-in.password-confirmation-input' } & Passwords)
  | { readonly type: 'user.sign-in.resend-button'; readonly email: string }

/** The params of the flow's effects: an anchor shows one of the codes or goes; the app moves to a path. */
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

/** What the machine asks of its host: a code shown or cleared outside the form, a move to a path. */
export type SignInEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

/** The form the submit button sent, which a sign-in or a sign-up takes. */
function formInput({ event }: { readonly event: SignInEvent }): { readonly form: SignInForm } {
  assertEvent(event, 'user.sign-in.submit-button')

  return { form: event.form }
}

/** How the password typed again stands to the password, as the event carries both. */
function confirmationOf(event: SignInEvent): PasswordConfirmation {
  assertEvent(event, [
    'user.sign-in.submit-button',
    'user.sign-in.password-input',
    'user.sign-in.password-confirmation-input',
  ])

  return checkPasswordConfirmation(
    event.type === 'user.sign-in.submit-button'
      ? { password: event.form.password, confirmation: event.confirmation }
      : event,
  )
}

/** The email the resend button sent, which the resend takes. */
function emailInput({ event }: { readonly event: SignInEvent }): { readonly email: string } {
  assertEvent(event, 'user.sign-in.resend-button')

  return { email: event.email }
}

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
 * The sign-in form as the screen's flow says (`contract/domain/screens/sign-in.yaml`): the mode is
 * the state, an attempt is an invoke of its platform action, a failure goes back to the mode with
 * its code; a sign-up, or a resend of the verification mail, leaves the form in the mode sign-in
 * asking to check the mail, and a sign-in of an account not verified yet offers the resend. At
 * sign-up the password typed again is compared as either is typed, and holds the submit while it
 * differs. Its `show` and `clear` keep the codes of the form's own error and mail message for the
 * view and emit any other; its `navigate` emits the path, for the host to move to.
 */
export function createSignInMachine(service: Pick<SignInService, 'signIn' | 'signUp' | 'resend'>) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
      emitted: {} as SignInEmitted,
    },
    guards: {
      emailNotVerified: ({ event }) =>
        failureOf(event, UNKNOWN_FAILURE) === 'data:EMAIL_NOT_VERIFIED',
      passwordsDiffer: ({ event }) => confirmationOf(event) !== 'same',
      confirmationStrays: ({ event }) => confirmationOf(event) === 'strayed',
      confirmationFollows: ({ event }) => confirmationOf(event) !== 'strayed',
    },
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
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    },
  }).createMachine({
    id: 'user.sign-in',
    initial: 'sign-in',
    context: { error: undefined, mail: undefined, sentTo: undefined },
    states: {
      'sign-in': {
        on: {
          'user.sign-in.toggle-button': { target: 'sign-up', actions: [clearError] },
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
          'user.sign-in.password-input': {
            target: 'passwords-differ',
            guard: 'confirmationStrays',
          },
          'user.sign-in.submit-button': [
            { target: 'passwords-differ', guard: 'passwordsDiffer' },
            { target: 'signing-up' },
          ],
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
          'user.sign-in.password-input': { target: 'sign-up', guard: 'confirmationFollows' },
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
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in', actions: [clearMail] },
          'user.sign-in.toggle-button': { target: 'sign-up', actions: [clearMail] },
        },
      },
      unverified: {
        on: {
          'user.sign-in.resend-button': { target: 'resending' },
          'user.sign-in.submit-button': { target: 'signing-in' },
          'user.sign-in.toggle-button': { target: 'sign-up', actions: [clearError] },
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
    },
  })
}
