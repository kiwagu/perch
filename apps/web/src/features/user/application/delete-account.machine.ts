import type { ResultAsync } from 'neverthrow'
import { enqueueActions, fromPromise, setup } from 'xstate'

import type { DataError } from '@workspace/data'

import { failureOf, settled } from '../../../platform/actor-outcome'
import type { ClearParams, ShowParams } from '../../../platform/flow-effects'

/** The anchors whose codes the machine keeps for the view. */
const ERROR = 'user.delete-account.error'
const MESSAGE = 'user.delete-account.message'

/** The code of a failure that carries none. */
const UNKNOWN_FAILURE = 'delete-account:UNKNOWN'

/** The failures of a link that does not delete: unknown, used, replaced, or too old. */
const LINK_UNUSABLE: readonly string[] = ['data:LINK_INVALID', 'data:LINK_EXPIRED']

/** The codes the flow shows for a link that does not delete the account. */
const LINK_FAILURES = ['link-invalid', 'link-expired']

/** The codes the flow shows for any other refusal, which leaves the button for another press. */
const KEPT_FAILURES = ['last-admin', 'rate-limited', 'failed']

export interface DeleteAccountContext {
  /** The code of the last failure. */
  readonly error: string | undefined
  /** The code the message shows once the account is gone. */
  readonly message: 'account-deleted' | undefined
}

/** The events of the screen's flow: the press of the button that deletes the account. */
export type DeleteAccountEvent = { readonly type: 'user.delete-account.delete-button' }

/** What the machine asks of its host: a code shown or cleared outside the page. */
export type DeleteAccountEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)

export interface DeleteAccountMachineDeps {
  /** The token of the address the page was opened at. */
  readonly token: string
  /** Deletes the account the link's token names. */
  readonly deleteAccount: (token: string) => ResultAsync<void, DataError>
}

const showError = (...codes: readonly string[]) =>
  ({ type: 'show', params: { anchor: ERROR, codes } }) as const

/**
 * The page a deletion mail's link opens, as its screen's flow says: it asks with its button, and
 * the press deletes the account the address's token names, ending on the message that the account
 * is gone, or on a link that does not work; any other refusal says why and leaves the button for
 * another press, which the same link takes within its hour. The machine holds the message whatever
 * the session does: a deletion of the account signed in here signs this device out. Its `show` and
 * `clear` keep the codes of the page's error and message for the view and emit any other.
 */
export function createDeleteAccountMachine(deps: DeleteAccountMachineDeps) {
  return setup({
    types: {
      context: {} as DeleteAccountContext,
      events: {} as DeleteAccountEvent,
      emitted: {} as DeleteAccountEmitted,
    },
    guards: {
      linkUnusable: ({ event }) => LINK_UNUSABLE.includes(failureOf(event, UNKNOWN_FAILURE)),
    },
    actors: {
      'platform.delete-account': fromPromise<void, { readonly token: string }>(({ input }) =>
        settled(deps.deleteAccount(input.token)),
      ),
    },
    actions: {
      show: enqueueActions(({ enqueue, event }, params: ShowParams) => {
        if (params.anchor === ERROR) {
          enqueue.assign({ error: failureOf(event, UNKNOWN_FAILURE) })
        } else if (params.anchor === MESSAGE) {
          enqueue.assign({
            message: params.codes.includes('account-deleted') ? 'account-deleted' : undefined,
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
    id: 'user.delete-account',
    initial: 'asking',
    context: { error: undefined, message: undefined },
    states: {
      asking: {
        meta: { renders: ['user.delete-account.delete-button'] },
        on: { 'user.delete-account.delete-button': { target: 'deleting' } },
      },
      deleting: {
        meta: { renders: ['user.delete-account.delete-button'] },
        entry: [{ type: 'clear', params: { anchor: ERROR } }],
        invoke: {
          src: 'platform.delete-account',
          input: () => ({ token: deps.token }),
          onDone: {
            target: 'done',
            actions: [{ type: 'show', params: { anchor: MESSAGE, codes: ['account-deleted'] } }],
          },
          onError: [
            { target: 'link-dead', guard: 'linkUnusable', actions: [showError(...LINK_FAILURES)] },
            { target: 'asking', actions: [showError(...KEPT_FAILURES)] },
          ],
        },
      },
      'link-dead': { type: 'final' },
      done: { type: 'final', meta: { renders: ['user.delete-account.sign-in-link'] } },
    },
  })
}
