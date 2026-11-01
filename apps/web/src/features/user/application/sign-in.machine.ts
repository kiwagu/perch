import { assertEvent, assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { AuthUser } from '@workspace/data'

import type { SignInForm, SignInMode, SignInService } from './sign-in.service'

/** The anchor of the form's own error: the machine keeps the code it shows for the view. */
const SIGN_IN_ERROR = 'user.sign-in.error'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'sign-in:UNKNOWN'

export interface SignInContext {
  /** The code of the last failure, cleared by the next attempt and by a switch of mode. */
  readonly error: string | undefined
}

/** The events of the screen's flow: the user acts on these anchors. */
export type SignInEvent =
  | { readonly type: 'user.sign-in.toggle-button' }
  | { readonly type: 'user.sign-in.submit-button'; readonly form: SignInForm }

/** The params of the flow's effects: an anchor shows one of the codes; the app moves to a path. */
interface ShowParams {
  readonly anchor: string
  readonly codes: readonly string[]
}

interface NavigateParams {
  readonly to: string
}

/** What the machine asks of its host: a code shown outside the form, a move to a path. */
export type SignInEmitted =
  | ({ readonly type: 'show' } & ShowParams)
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

/** One attempt in a mode: it resolves with the account, or rejects with the failure. */
const attempt = (service: Pick<SignInService, 'submit'>, mode: SignInMode) =>
  fromPromise<AuthUser, { readonly form: SignInForm }>(async ({ input }) => {
    const result = await service.submit(mode, input.form)

    return result.isOk() ? result.value : Promise.reject(result.error)
  })

/** The form the submit button sent, which the attempt takes. */
function formInput({ event }: { readonly event: SignInEvent }): { readonly form: SignInForm } {
  assertEvent(event, 'user.sign-in.submit-button')

  return { form: event.form }
}

/**
 * The sign-in form as the screen's flow says (`contract/domain/screens/sign-in.yaml`): the mode is
 * the state, an attempt is an invoke of its platform action, a failure goes back to the
 * mode with its code. Its `show` keeps the code of the form's own error for the view and
 * emits any other; its `navigate` emits the path, for the host to move to.
 */
export function createSignInMachine(service: Pick<SignInService, 'submit'>) {
  return setup({
    types: {
      context: {} as SignInContext,
      events: {} as SignInEvent,
      emitted: {} as SignInEmitted,
    },
    actors: {
      'platform.sign-in': attempt(service, 'sign-in'),
      'platform.sign-up': attempt(service, 'sign-up'),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === SIGN_IN_ERROR) {
          enqueue.assign({ error: failureOf(event) })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
      clearError: assign({ error: undefined }),
    },
  }).createMachine({
    id: 'user.sign-in',
    initial: 'sign-in',
    context: { error: undefined },
    states: {
      'sign-in': {
        on: {
          'user.sign-in.toggle-button': { target: 'sign-up', actions: 'clearError' },
          'user.sign-in.submit-button': { target: 'signing-in' },
        },
      },
      'sign-up': {
        on: {
          'user.sign-in.toggle-button': { target: 'sign-in', actions: 'clearError' },
          'user.sign-in.submit-button': { target: 'signing-up' },
        },
      },
      'signing-in': {
        entry: 'clearError',
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
          onError: {
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
        },
      },
      'signing-up': {
        entry: 'clearError',
        invoke: {
          src: 'platform.sign-up',
          input: formInput,
          onDone: {
            target: 'done',
            actions: [
              { type: 'show', params: { anchor: 'app-shell.notice-message', codes: ['welcome'] } },
              { type: 'navigate', params: { to: '/me' } },
            ],
          },
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
                    'other-account',
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
      done: { type: 'final' },
    },
  })
}
