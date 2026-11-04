import type { ResultAsync } from 'neverthrow'
import { assertEvent, enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../platform/flow-effects'
import type { Passwords } from '../domain/password-confirmation.rule'

import { newPasswordGuards } from './new-password-guards.policy'
import type { SignInError } from './sign-in.service'

/** The anchors whose codes the machine keeps for the view. */
const ERROR = 'user.reset-password.error'
const MESSAGE = 'user.reset-password.message'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'reset-password:UNKNOWN'

/** The code the error keeps while the password typed again differs, which the form finds itself. */
export const RESET_PASSWORDS_DIFFER = 'reset-password:PASSWORDS_DIFFER'

/** The failures of a link that does not set a password: unknown, used, replaced, or too old. */
const LINK_UNUSABLE: readonly string[] = ['data:LINK_INVALID', 'data:LINK_EXPIRED']

/** The codes the flow shows for a link that does not set a password. */
const LINK_FAILURES = ['link-invalid', 'link-expired']

/** The codes the flow shows for any other failure of the reset, which leaves the form as typed. */
const KEPT_FAILURES = ['password-rejected', 'rate-limited', 'failed']

export interface ResetPasswordContext {
  /** The code of the last failure, or of the password typed again differing. */
  readonly error: string | undefined
  /** The code the message shows once the password is the new one. */
  readonly message: 'password-reset' | undefined
}

/**
 * The events of the screen's flow: a keystroke in either password and the submit, each with both
 * passwords as typed; the password typed again is never sent.
 */
export type ResetPasswordEvent =
  | ({ readonly type: 'user.reset-password.password-input' } & Passwords)
  | ({ readonly type: 'user.reset-password.password-confirmation-input' } & Passwords)
  | ({ readonly type: 'user.reset-password.submit-button' } & Passwords)

/** What the machine asks of its host: a code shown or cleared outside the page. */
export type ResetPasswordEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)

export interface ResetPasswordMachineDeps {
  /** The token of the address the page was opened at. */
  readonly token: string
  /** Sets the new password with the link's token. */
  readonly reset: (token: string, password: string) => ResultAsync<void, SignInError>
}

/** The passwords an event of the form carries as typed. */
function passwordsOf(event: ResetPasswordEvent): Passwords {
  return { password: event.password, confirmation: event.confirmation }
}

/** The new password the submit sent, which the reset takes. */
function passwordInput({ event }: { readonly event: ResetPasswordEvent }): {
  readonly password: string
} {
  assertEvent(event, 'user.reset-password.submit-button')

  return { password: event.password }
}

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: ERROR, codes } }) as const
const clearError = { type: 'clear', params: { anchor: ERROR } } as const

/**
 * The page a reset mail's link opens, as its screen's flow says: the new password is held to the
 * rules of a new password and to the password typed again as either is typed, the submit is taken only while they
 * agree, and the reset of the address's token ends on the message that the password is the new
 * one, or on a link that does not work; any other refusal leaves the form as typed. Its `show` and
 * `clear` keep the codes of the page's error and message for the view and emit any other.
 */
export function createResetPasswordMachine(deps: ResetPasswordMachineDeps) {
  return setup({
    types: {
      context: {} as ResetPasswordContext,
      events: {} as ResetPasswordEvent,
      emitted: {} as ResetPasswordEmitted,
    },
    guards: {
      ...newPasswordGuards(passwordsOf),
      linkUnusable: ({ event }) => LINK_UNUSABLE.includes(failureOf(event, UNKNOWN_FAILURE)),
    },
    actors: {
      'platform.reset-password': fromPromise<void, { readonly password: string }>(({ input }) =>
        settled(deps.reset(deps.token, input.password)),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === ERROR) {
          // The form finds the passwords differ itself; any other code is the failure's.
          enqueue.assign({
            error: params.codes.includes('passwords-differ')
              ? RESET_PASSWORDS_DIFFER
              : failureOf(event, UNKNOWN_FAILURE),
          })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({
            message: params.codes.includes('password-reset') ? 'password-reset' : undefined,
          })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({ message: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
    },
  }).createMachine({
    id: 'user.reset-password',
    initial: 'password-weak',
    context: { error: undefined, message: undefined },
    states: {
      // The list marks the rules the password keeps; the password typed again waits to be judged,
      // and the submit is not taken.
      'password-weak': {
        on: {
          'user.reset-password.password-input': [
            { guard: 'passwordBreaksRules' },
            { target: 'passwords-differ', guard: 'confirmationStrays' },
            { target: 'kept' },
          ],
        },
      },
      kept: {
        on: {
          'user.reset-password.password-input': [
            { target: 'password-weak', guard: 'passwordBreaksRules' },
            { target: 'passwords-differ', guard: 'confirmationStrays' },
          ],
          'user.reset-password.password-confirmation-input': {
            target: 'passwords-differ',
            guard: 'confirmationStrays',
          },
          'user.reset-password.submit-button': [
            { target: 'passwords-differ', guard: 'passwordsDiffer' },
            { target: 'resetting' },
          ],
        },
      },
      'passwords-differ': {
        entry: [showError('passwords-differ')],
        exit: [clearError],
        on: {
          'user.reset-password.password-input': [
            { target: 'password-weak', guard: 'passwordBreaksRules' },
            { target: 'kept', guard: 'confirmationFollows' },
          ],
          'user.reset-password.password-confirmation-input': {
            target: 'kept',
            guard: 'confirmationFollows',
          },
        },
      },
      resetting: {
        entry: [clearError],
        invoke: {
          src: 'platform.reset-password',
          input: passwordInput,
          onDone: {
            target: 'done',
            actions: [{ type: 'show', params: { anchor: MESSAGE, codes: ['password-reset'] } }],
          },
          onError: [
            { target: 'link-dead', guard: 'linkUnusable', actions: [showError(...LINK_FAILURES)] },
            { target: 'kept', actions: [showError(...KEPT_FAILURES)] },
          ],
        },
      },
      'link-dead': { type: 'final' },
      done: { type: 'final' },
    },
  })
}
