import { idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import type { AccountCard, ListedAccount } from '../account-directory'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import type { Handler } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'

/** The sizes a page of the accounts list takes, as the contract's `accounts.list` pages. */
export const ACCOUNT_PAGE_SIZES = [10, 25, 50] as const

/** The size of a page of the accounts list when the query names none. */
export const DEFAULT_ACCOUNT_PAGE_SIZE = 25

/** The longest text the list is searched with, as the users screen's `q` takes it. */
const MAX_SEARCH = 254

/** A whole number from 1 written in digits alone, as a query carries it. */
const counting = z
  .string()
  .regex(/^[1-9][0-9]*$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(Number.MAX_SAFE_INTEGER))

/** What a list's query carries: each key once, none but these. */
const listQuery = z
  .object({
    q: z.string().max(MAX_SEARCH).default(''),
    page: counting.default(1),
    size: counting.pipe(z.literal(ACCOUNT_PAGE_SIZES)).default(DEFAULT_ACCOUNT_PAGE_SIZE),
  })
  .strict()

/** The parameters of `url`'s query, or `undefined` when one is given twice. */
function queryOf(url: URL): Record<string, string> | undefined {
  const query = new Map<string, string>()

  for (const [key, value] of url.searchParams) {
    if (query.has(key)) {
      return undefined
    }

    query.set(key, value)
  }

  return Object.fromEntries(query)
}

/** An account as the list answers it. */
const listedAnswer = (account: ListedAccount) => ({
  id: account.id,
  name: account.name,
  email: account.email,
  emailVerified: account.emailVerified,
  banned: account.banned,
  operator: account.operator,
  createdAt: account.createdAt.toISOString(),
})

/** An account as its card answers it: what it lacks as `null`. */
const cardAnswer = (account: AccountCard) => ({
  id: account.id,
  name: account.name,
  email: account.email,
  emailVerified: account.emailVerified,
  createdAt: account.createdAt.toISOString(),
  hasProfile: account.hasProfile,
  lastSeenAt: account.lastSeenAt?.toISOString() ?? null,
  operator: account.operator,
  banned: account.banned,
  banReason: account.banReason ?? null,
  organisations: account.organisations,
})

/** The console's reads, each for an operator: the list of the accounts, and one account's card. */
export function readHandlers(options: ConsoleRoutesOptions) {
  const failed = errorAnswer(options.onFailure)

  const list: Handler = async (_operator, request) => {
    const query = listQuery.safeParse(queryOf(new URL(request.url)))

    if (!query.success) {
      return refusalAnswer('bad-request')
    }

    return (await options.accounts.list(query.data)).match(
      ({ accounts, total }) => Response.json({ accounts: accounts.map(listedAnswer), total }),
      failed,
    )
  }

  const read =
    (id: string): Handler =>
    async () => {
      const identity = idSchemas.identity.schema.safeParse(id)

      // An id of another form names no account.
      if (!identity.success) {
        return refusalAnswer('account-gone')
      }

      return (await options.accounts.read(identity.data)).match(
        (account) =>
          account === undefined
            ? refusalAnswer('account-gone')
            : Response.json({ account: cardAnswer(account) }),
        failed,
      )
    }

  return { list, read }
}
