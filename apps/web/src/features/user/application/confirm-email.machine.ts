import type { ResultAsync } from 'neverthrow'
import { enqueueActions, fromPromise, setup } from 'xstate'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../platform/flow-effects'
import type { EmailConfirmed } from '../../../platform/session.port'

import type { SignInError } from './sign-in.service'

/** The anchors whose codes the machine keeps for the view. */
const ERROR = 'user.confirm-email.error'
const MESSAGE = 'user.confirm-email.message'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'confirm-email:UNKNOWN'

const EMAIL_CHANGED = {
  type: 'show',
  params: { anchor: MESSAGE, codes: ['email-changed'] },
} as const

export interface ConfirmEmailContext {
  /** The code of the failure the error shows. */
  readonly error: string | undefined
  /** The code the message shows once the email is the new one. */
  readonly message: 'email-changed' | undefined
}

/** What the machine asks of its host: a code shown or cleared outside the page. */
export type ConfirmEmailEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)

export interface ConfirmEmailMachineDeps {
  /** The token of the address the page was opened at. */
  readonly token: string
  readonly confirm: (token: string) => ResultAsync<EmailConfirmed, SignInError>
  /** The identity signed in on this device now, if any. */
  readonly current: () => string | undefined
}

/** The account a confirmation that ended with `event` changed the email of. */
function confirmedIdentity(event: object): string | undefined {
  const output = 'output' in event ? event.output : undefined

  return typeof output === 'object' &&
    output !== null &&
    'identity' in output &&
    typeof output.identity === 'string'
    ? output.identity
    : undefined
}

/**
 * The page a confirmation mail's link opens, as the screen's flow says
 * (`contract/domain/screens/confirm-email.yaml`): it starts by confirming the token of its
 * address, then says the email is the new one, ending by who is signed in here: this account
 * (`done-here`, beside the profile), nobody (`done`, beside the sign-in page) or another account
 * (`done-elsewhere`, with no link); a link refused ends on its error. Its `show` and `clear` keep
 * the codes of the page's error and message for the view and emit any other.
 */
export function createConfirmEmailMachine(deps: ConfirmEmailMachineDeps) {
  return setup({
    types: {
      context: {} as ConfirmEmailContext,
      emitted: {} as ConfirmEmailEmitted,
    },
    guards: {
      thisAccount: ({ event }) => {
        const here = deps.current()

        return here !== undefined && here === confirmedIdentity(event)
      },
      nobodyHere: () => deps.current() === undefined,
    },
    actors: {
      'platform.confirm-email': fromPromise<EmailConfirmed, { readonly token: string }>(
        ({ input }) => settled(deps.confirm(input.token)),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({
            message: params.codes.includes('email-changed') ? 'email-changed' : undefined,
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
    id: 'user.confirm-email',
    initial: 'confirming',
    context: { error: undefined, message: undefined },
    states: {
      confirming: {
        invoke: {
          src: 'platform.confirm-email',
          input: () => ({ token: deps.token }),
          onDone: [
            { target: 'done-here', guard: 'thisAccount', actions: [EMAIL_CHANGED] },
            { target: 'done', guard: 'nobodyHere', actions: [EMAIL_CHANGED] },
            { target: 'done-elsewhere', actions: [EMAIL_CHANGED] },
          ],
          onError: {
            target: 'failed',
            actions: [
              {
                type: 'show',
                params: {
                  anchor: ERROR,
                  codes: ['link-invalid', 'link-expired', 'rate-limited', 'failed'],
                },
              },
            ],
          },
        },
      },
      'done-here': { type: 'final' },
      done: { type: 'final' },
      'done-elsewhere': { type: 'final' },
      failed: { type: 'final' },
    },
  })
}
