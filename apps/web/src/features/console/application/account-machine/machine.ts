import type { ResultAsync } from 'neverthrow'
import { assign, emit, enqueueActions, fromPromise, setup } from 'xstate'

import type { IdentityId } from '@workspace/ids'

import {
  BAN_CODES,
  type BanCode,
  CHANGE_EMAIL_CODES,
  type ChangeEmailCode,
  REMOVE_CODES,
  RENAME_CODES,
  RESEND_VERIFICATION_CODES,
  REVOKE_SESSIONS_CODES,
  type RemoveCode,
  type RenameCode,
  type ResendVerificationCode,
  type RevokeSessionsCode,
  SEND_RESET_CODES,
  type SendResetCode,
  UNBAN_CODES,
  type UnbanCode,
} from '../../../../platform/accounts.port'
import { failureOf, settled } from '../../../../platform/actor-outcome'
import type { ClearParams, NavigateParams, ShowParams } from '../../../../platform/flow-effects'
import type { AccountsService } from '../accounts.service'

import { AREA_ERRORS, type ErrorArea } from './effects'
import {
  type AccountEvent,
  BAN_REGION,
  EMAIL_REGION,
  NAME_REGION,
  REMOVAL_REGION,
  RESET_REGION,
  SESSIONS_REGION,
  VERIFICATION_REGION,
} from './states'

export type { ErrorArea } from './effects'
export type { AccountEvent } from './states'

/** A code an area's error shows: one of the codes of the actions on an account. */
export type AccountErrorCode =
  | RenameCode
  | ChangeEmailCode
  | BanCode
  | UnbanCode
  | RevokeSessionsCode
  | SendResetCode
  | ResendVerificationCode
  | RemoveCode

const ERROR_CODES: ReadonlySet<string> = new Set<string>([
  ...RENAME_CODES,
  ...CHANGE_EMAIL_CODES,
  ...BAN_CODES,
  ...UNBAN_CODES,
  ...REVOKE_SESSIONS_CODES,
  ...SEND_RESET_CODES,
  ...RESEND_VERIFICATION_CODES,
  ...REMOVE_CODES,
])

const isErrorCode = (code: string): code is AccountErrorCode => ERROR_CODES.has(code)

/** The code each area of the card shows in its error: that of its last refused action. */
export type AccountErrors = { readonly [Area in ErrorArea]?: AccountErrorCode }

export interface AccountContext {
  readonly errors: AccountErrors
  /** How many reads of the card the flow asked for: the page reads it again after each. */
  readonly sectionReads: number
}

/** What the machine asks of its host: a toast shown, a field emptied, a move to the accounts. */
export type AccountEmitted =
  | ({ readonly type: 'show' } & ShowParams)
  | ({ readonly type: 'clear' } & ClearParams)
  | ({ readonly type: 'navigate' } & NavigateParams)

/** The actions on an account the card takes, each failing with a code of its action. */
export type AccountActions = Pick<
  AccountsService,
  | 'rename'
  | 'changeEmail'
  | 'ban'
  | 'unban'
  | 'revokeSessions'
  | 'sendReset'
  | 'resendVerification'
  | 'remove'
>

export interface AccountMachineDeps {
  /** The account of the card: the identity its address names. */
  readonly id: IdentityId
  readonly accounts: AccountActions
}

/** The area whose error an anchor is, by the anchor. */
const AREA_OF: ReadonlyMap<string, ErrorArea> = new Map(Object.entries(AREA_ERRORS))

/** An area's error anchor, when `anchor` is one. */
const areaOf = (anchor: string): ErrorArea | undefined => AREA_OF.get(anchor)

/**
 * The code an area's error shows for the failure that ended its action: the failure's own when
 * it is one the flow shows there, `failed` (any other reason) otherwise.
 */
const shownCode = (event: object, codes: readonly string[]): AccountErrorCode => {
  const code = failureOf(event, 'failed')

  return codes.includes(code) && isErrorCode(code) ? code : 'failed'
}

/**
 * The account's card as the screen's flow says (`contract/domain/screens/console/account.yaml`):
 * `viewing` runs its areas in parallel, the name, the email, the ban, the sessions, the reset, the
 * verification and the removal, each running one action on the account at a time; a removal done
 * ends the card (`removed`). A control is enabled while a state handles its event
 * (`snapshot.can`). Its `show` keeps the code of an area's error for the view and emits a toast;
 * its `clear` is emitted for the host to empty a field; its `read` counts a read of the card, which
 * the view makes; its `navigate` is emitted for the host to move.
 */
export function createAccountMachine(deps: AccountMachineDeps) {
  /** An action on the card's account, as an invoke: done, or rejected with its failure. */
  const acting = <I = undefined>(run: (input: I) => ResultAsync<void, unknown>) =>
    fromPromise<void, I>(({ input }) => settled(run(input)))
  const { id, accounts } = deps

  return setup({
    types: {
      context: {} as AccountContext,
      events: {} as AccountEvent,
      emitted: {} as AccountEmitted,
    },
    actors: {
      'platform.accounts.rename': acting(({ name }: { readonly name: string }) =>
        accounts.rename(id, name),
      ),
      'platform.accounts.change-email': acting(({ email }: { readonly email: string }) =>
        accounts.changeEmail(id, email),
      ),
      'platform.accounts.ban': acting(({ reason }: { readonly reason: string }) =>
        accounts.ban(id, reason),
      ),
      'platform.accounts.unban': acting(() => accounts.unban(id)),
      'platform.accounts.revoke-sessions': acting(() => accounts.revokeSessions(id)),
      'platform.accounts.send-reset': acting(() => accounts.sendReset(id)),
      'platform.accounts.resend-verification': acting(() => accounts.resendVerification(id)),
      'platform.accounts.remove': acting(() => accounts.remove(id)),
    },
    actions: {
      show: enqueueActions(({ enqueue, context, event }, params: ShowParams) => {
        const area = areaOf(params.anchor)

        if (area === undefined) {
          enqueue.emit({ type: 'show', ...params })

          return
        }

        enqueue.assign({ errors: { ...context.errors, [area]: shownCode(event, params.codes) } })
      }),
      clear: emit((_, params: ClearParams) => ({ type: 'clear' as const, ...params })),
      read: assign({ sectionReads: ({ context }) => context.sectionReads + 1 }),
      navigate: emit((_, params: NavigateParams) => ({ type: 'navigate' as const, ...params })),
      forget: assign(({ context }, params: { readonly area: ErrorArea }) => ({
        errors: { ...context.errors, [params.area]: undefined },
      })),
    },
  }).createMachine({
    id: 'account',
    initial: 'viewing',
    context: { errors: {}, sectionReads: 0 },
    states: {
      viewing: {
        type: 'parallel',
        states: {
          name: NAME_REGION,
          email: EMAIL_REGION,
          ban: BAN_REGION,
          sessions: SESSIONS_REGION,
          reset: RESET_REGION,
          verification: VERIFICATION_REGION,
          removal: REMOVAL_REGION,
        },
      },
      removed: { type: 'final' },
    },
  })
}
