import type { ResultAsync } from 'neverthrow'
import { assertEvent, enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../platform/flow-effects'

import type { SignInError } from './sign-in.service'

/** The anchors whose codes the machine keeps for the view. */
const ERROR = 'user.forgot-password.error'
const MESSAGE = 'user.forgot-password.message'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'forgot-password:UNKNOWN'

export interface ForgotPasswordContext {
  /** The code of the last failure, cleared by the next attempt. */
  readonly error: string | undefined
  /** The code the message shows once the request went through. */
  readonly message: 'check-your-mail' | undefined
  /** The address the last request that went through named, which the message names. */
  readonly sentTo: string | undefined
}

/** The events of the screen's flow: the user acts on these anchors. */
export type ForgotPasswordEvent = {
  readonly type: 'user.forgot-password.send-button'
  readonly email: string
}

/** What the machine asks of its host: a code shown or cleared outside the page. */
export type ForgotPasswordEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)

export interface ForgotPasswordMachineDeps {
  /** Asks for the mail whose link sets a new password; any email gets the same answer. */
  readonly request: (email: string) => ResultAsync<void, SignInError>
}

/** The email the send button sent, which the request takes. */
function emailInput({ event }: { readonly event: ForgotPasswordEvent }): {
  readonly email: string
} {
  assertEvent(event, 'user.forgot-password.send-button')

  return { email: event.email }
}

/**
 * The page that asks for the mail of a password reset, as its screen's flow says: the send button
 * asks for it, the message asks to
 * open its link once the request went through, a refusal says why, and the button asks again as
 * often as it is pressed. Its `show` and `clear` keep the codes of the page's error and message for
 * the view and emit any other.
 */
export function createForgotPasswordMachine(deps: ForgotPasswordMachineDeps) {
  return setup({
    types: {
      context: {} as ForgotPasswordContext,
      events: {} as ForgotPasswordEvent,
      emitted: {} as ForgotPasswordEmitted,
    },
    actors: {
      // It ends with the address it asked for: the message names that one, not the field's.
      'platform.request-password-reset': fromPromise<string, { readonly email: string }>(
        ({ input }) => settled(deps.request(input.email)).then(() => input.email),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({
            message: params.codes.includes('check-your-mail') ? 'check-your-mail' : undefined,
            sentTo:
              'output' in event && typeof event.output === 'string' ? event.output : undefined,
          })
        } else {
          enqueue.emit({ type: 'show', ...params })
        }
      }),
      clear: enqueueActions(({ enqueue }, params: ClearParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: undefined })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({ message: undefined, sentTo: undefined })
        } else {
          enqueue.emit({ type: 'clear', ...params })
        }
      }),
    },
  }).createMachine({
    id: 'user.forgot-password',
    initial: 'idle',
    context: { error: undefined, message: undefined, sentTo: undefined },
    states: {
      idle: {
        on: { 'user.forgot-password.send-button': { target: 'sending' } },
      },
      sending: {
        entry: [{ type: 'clear', params: { anchor: ERROR } }],
        invoke: {
          src: 'platform.request-password-reset',
          input: emailInput,
          onDone: {
            target: 'sent',
            actions: [{ type: 'show', params: { anchor: MESSAGE, codes: ['check-your-mail'] } }],
          },
          onError: {
            target: 'idle',
            actions: [
              { type: 'clear', params: { anchor: MESSAGE } },
              { type: 'show', params: { anchor: ERROR, codes: ['rate-limited', 'failed'] } },
            ],
          },
        },
      },
      sent: {
        on: { 'user.forgot-password.send-button': { target: 'sending' } },
      },
    },
  })
}
