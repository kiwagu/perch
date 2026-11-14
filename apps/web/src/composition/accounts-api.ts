/**
 * The gateway's console routes over HTTP, for an operator: a page of the platform's accounts and
 * one account's card. Each request is made with the credentials of the tab when it starts, read
 * once (the identity the tab shows, the session token saved for it and the sign-in that saved
 * it), and the device's id (`X-Perch-Device`). A refusal because that identity is no operator
 * (403 `not-operator`) takes `operator` off the roles this browser keeps for that sign-in alone,
 * whichever sign-in the tab or the browser shows by the time it is answered: a later one, of the
 * same account or not, keeps the roles its own welcome brought.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'
import { tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import {
  type AccountCard,
  type AccountSearch,
  type AccountsPort,
  BAN_CODES,
  CHANGE_EMAIL_CODES,
  type ConsoleFailure,
  LIST_CODES,
  type ListedAccount,
  READ_CODES,
  REMOVE_CODES,
  RENAME_CODES,
  RESEND_VERIFICATION_CODES,
  REVOKE_SESSIONS_CODES,
  SEND_RESET_CODES,
  UNBAN_CODES,
} from '../platform/accounts.port'

import type { Fetcher } from './gateway-auth'
import { type BearerCalls, bearerCalls } from './gateway-bearer'

/** The identity a request is made for, and the session token it presents. */
export interface Credentials {
  readonly identity: IdentityId
  readonly token: string
  /** The sign-in this browser keeps the token under: what a refusal of it changes is its own. */
  readonly signIn: string
}

export interface AccountsDeps {
  /**
   * The credentials of a request, read once as it starts: the identity the tab shows and the
   * session token this browser saved for it; none while it shows nobody or keeps another's token.
   */
  readonly credentials: () => Credentials | undefined
  /** The device's own id, named in every call. */
  readonly device: () => string
  /**
   * Takes `role` off the roles this browser keeps for the sign-in `asker` names, and from no other
   * sign-in.
   */
  readonly dropRole: (asker: Credentials, role: PlatformRole) => void
  readonly fetcher?: Fetcher
}

/** An account as `GET /console/accounts` lists it, its time as an ISO string. */
const listedAccount = z.object({
  id: idSchemas.identity.schema,
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  banned: z.boolean(),
  operator: z.boolean(),
  createdAt: z.iso.datetime(),
})

const listed = z.object({
  accounts: z.array(listedAccount),
  total: z.number().int().nonnegative(),
})

/** An account as `GET /console/accounts/:id` answers it: what it lacks as `null`. */
const accountCard = listedAccount.extend({
  hasProfile: z.boolean(),
  lastSeenAt: z.iso.datetime().nullable(),
  banReason: z.string().nullable(),
  organisations: z.array(z.object({ key: z.string(), name: z.string(), role: tenantRole })),
})

const card = z.object({ account: accountCard })

function listedView(account: z.infer<typeof listedAccount>): ListedAccount {
  return { ...account, createdAt: new Date(account.createdAt) }
}

function cardView(account: z.infer<typeof accountCard>): AccountCard {
  const { lastSeenAt, banReason, ...rest } = account

  return {
    ...listedView(rest),
    hasProfile: account.hasProfile,
    organisations: account.organisations,
    ...(lastSeenAt === null ? {} : { lastSeenAt: new Date(lastSeenAt) }),
    ...(banReason === null ? {} : { banReason }),
  }
}

/**
 * Why a call failed, as its action says it: the gateway's refusal code when the action has it,
 * `failed` for any other refusal, an answer of another shape, a dead token or an unreachable
 * gateway. The message names a status or a code, never a body.
 */
function failureOf<Code extends string>(
  codes: readonly [Code, ...Code[]],
  error: DataError,
): ConsoleFailure<Code | 'failed'> {
  const refused =
    error.code === 'data:WRITE_REJECTED' ? z.enum(codes).safeParse(error.message) : undefined

  return refused?.success === true
    ? { code: refused.data, message: `the gateway refused: ${refused.data}` }
    : { code: 'failed', message: `${error.code}: ${error.message}` }
}

/** The query of a page of accounts: the search text only when there is one. */
const queryOf = (search: AccountSearch): string =>
  new URLSearchParams({
    ...(search.q === '' ? {} : { q: search.q }),
    page: String(search.page),
    size: String(search.size),
  }).toString()

/**
 * `GET <baseUrl>/console/accounts?q&page&size`, `GET <baseUrl>/console/accounts/:id` and the
 * actions on an account, `POST <baseUrl>/console/accounts/:id/<action>` answered 204: each answer
 * parsed, each failure one of its action's codes.
 */
export function accountsApi(baseUrl: string, deps: AccountsDeps): AccountsPort {
  /** One call with the credentials of its start; a `not-operator` drops that sign-in's role. */
  const asking = <T, Code extends string>(
    codes: readonly [Code, ...Code[]],
    call: (calls: BearerCalls) => ResultAsync<T, DataError>,
  ): ResultAsync<T, ConsoleFailure<Code | 'failed'>> => {
    const asker = deps.credentials()
    const calls = bearerCalls(baseUrl, {
      token: () => asker?.token,
      device: deps.device,
      ...(deps.fetcher === undefined ? {} : { fetcher: deps.fetcher }),
    })

    return call(calls).mapErr((error) => {
      const failure = failureOf(codes, error)

      if (failure.code === 'not-operator' && asker !== undefined) {
        deps.dropRole(asker, 'operator')
      }

      return failure
    })
  }

  /** The path of the account `id` names, under the console's routes. */
  const accountPath = (id: IdentityId): string => `/console/accounts/${encodeURIComponent(id)}`

  /** `POST` of an action on the account `id`, with `body` when it takes one, done on a 204. */
  const acting =
    <Code extends string>(codes: readonly [Code, ...Code[]], action: string) =>
    (id: IdentityId, body?: object) =>
      asking(codes, (calls) => calls.empty(`${accountPath(id)}/${action}`, 'POST', body))

  const rename = acting(RENAME_CODES, 'rename')
  const changeEmail = acting(CHANGE_EMAIL_CODES, 'email')
  const ban = acting(BAN_CODES, 'ban')

  return {
    list: (search) =>
      asking(LIST_CODES, (calls) =>
        calls.json(`/console/accounts?${queryOf(search)}`, 'GET', listed),
      ).map((answer) => ({ accounts: answer.accounts.map(listedView), total: answer.total })),
    read: (id) =>
      asking(READ_CODES, (calls) => calls.json(accountPath(id), 'GET', card)).map((answer) =>
        cardView(answer.account),
      ),
    rename: (id, name) => rename(id, { name }),
    changeEmail: (id, email) => changeEmail(id, { email }),
    // The gateway takes a body for every ban, and trims the reason: an empty one is none.
    ban: (id, reason) => ban(id, { reason }),
    unban: acting(UNBAN_CODES, 'unban'),
    revokeSessions: acting(REVOKE_SESSIONS_CODES, 'sign-out'),
    sendReset: acting(SEND_RESET_CODES, 'reset'),
    resendVerification: acting(RESEND_VERIFICATION_CODES, 'verification'),
    remove: acting(REMOVE_CODES, 'removal'),
  }
}
