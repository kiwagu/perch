import type { ResultAsync } from 'neverthrow'
import { assertEvent, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { SignInError, SignInForm, SignInService } from './sign-in.service'

/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
const SIGN_IN_ERROR = 'user.sign-in.error'

/** The anchor of the message asking to open the verification mail: the machine keeps its code. */
const MAIL_MESSAGE = 'user.sign-in.mail-message'

/** The code the mail message shows. */
const CHECK_YOUR_MAIL = 'check-your-mail'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'sign-in:UNKNOWN'

export interface SignInContext {
  /** The code of the last failure, cleared by the next attempt and by a switch of mode. */
  readonly error: string | undefined
  /** The code of the mail message, shown once a sign-up or a resend went through. */
  readonly mail: typeof CHECK_YOUR_MAIL | undefined
}

/** The events of the screen's flow: the user acts on these anchors. */
export type SignInEvent =
  | { readonly type: 'user.sign-in.toggle-button' }
  | { readonly type: 'user.sign-in.submit-button'; readonly form: SignInForm }
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

/** The code a failed attempt rejected with, read off the error event of its invoke. */
function failureOf(event: object): string {
  const error = 'error' in event ? event.error : undefined

  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
    ? error.code
    : UNKNOWN_FAILURE
}

/** One attempt of a platform action: it resolves with its outcome, or rejects with the failure. */
const attempt = <T, Input>(run: (input: Input) => ResultAsync<T, SignInError>) =>
  fromPromise<T, Input>(async ({ input }) => {
    const result = await run(input)

    return result.isOk() ? result.value : Promise.reject(result.error)
  })

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
 * asking to check the mail, and a sign-in of an account not verified yet offers the resend. Its
 * `show` and `clear` keep the codes of the form's own error and mail message for the view and
 * emit any other; its `navigate` emits the path, for the host to move to.
 */
export function createSignInMachine(service: Pick<SignInService, 'signIn' | 'signUp' | 'resend'>) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
      emitted: {} as SignInEmitted,
    },
    guards: {
      emailNotVerified: ({ event }) => failureOf(event) === 'data:EMAIL_NOT_VERIFIED',
    },
    actors: {
      'platform.sign-in': attempt((input: { readonly form: SignInForm }) =>
        service.signIn(input.form),
      ),
      'platform.sign-up': attempt((input: { readonly form: SignInForm }) =>
        service.signUp(input.form),
      ),
      'platform.resend-verification': attempt((input: { readonly email: string }) =>
        service.resend(input.email),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === SIGN_IN_ERROR) {
          enqueue.assign({ error: failureOf(event) })
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
          enqueue.assign({ mail: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
    },
  }).createMachine({
    id: 'user.sign-in',
    initial: 'sign-in',
    context: { error: undefined, mail: undefined },
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
          'user.sign-in.submit-button': { target: 'signing-up' },
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
              actions: [
                { type: 'show', params: { anchor: SIGN_IN_ERROR, codes: ['email-not-verified'] } },
              ],
            },
            {
              target: 'sign-in',
              actions: [
                {
                  type: 'show',
                  params: {
                    anchor: SIGN_IN_ERROR,
                    codes: ['invalid-credentials', 'rate-limited', 'other-account', 'failed'],
                  },
                },
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
          onDone: { target: 'check-mail', actions: [showMail] },
          onError: {
            target: 'sign-up',
            actions: [
              {
                type: 'show',
                params: {
                  anchor: SIGN_IN_ERROR,
                  codes: [
                    'sign-up-rejected',
                    'rate-limited',
                    'name-required',
                    'name-too-long',
                    'failed',
                  ],
                },
              },
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
          onDone: { target: 'check-mail', actions: [showMail] },
          onError: {
            target: 'unverified',
            actions: [
              clearMail,
              {
                type: 'show',
                params: { anchor: SIGN_IN_ERROR, codes: ['rate-limited', 'failed'] },
              },
            ],
          },
        },
      },
      done: { type: 'final' },
    },
  })
}
