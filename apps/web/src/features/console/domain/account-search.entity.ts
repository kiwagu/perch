/**
 * The search of the platform's accounts an operator's page shows, as its address carries it
 * (`/console/users`): a part of the email or of the name the accounts are found by, the page from
 * 1, and how many accounts a page holds, one of the sizes `accounts.list` pages by. A value equal
 * to its default stays out of the address, and a size chosen is kept across a new search.
 */

import { z } from '@workspace/zod'

/** The sizes a page of accounts takes, the smallest first, as `accounts.list` pages them. */
export const ACCOUNT_PAGE_SIZES = [10, 25, 50] as const

/** A size a page of accounts takes. */
export type AccountPageSize = (typeof ACCOUNT_PAGE_SIZES)[number]

/** The size of a page of accounts while the address names none. */
export const DEFAULT_ACCOUNT_PAGE_SIZE: AccountPageSize = 25

/** The longest text accounts are searched with: the longest email. */
export const ACCOUNT_SEARCH_MAX = 254

export const AccountSearchSchema = z.object({
  q: z.string().max(ACCOUNT_SEARCH_MAX).optional(),
  page: z.int().min(1).default(1),
  // An integer among the sizes: the JSON Schema of a number literal says `number` by itself.
  size: z.literal(ACCOUNT_PAGE_SIZES).meta({ type: 'integer' }).default(DEFAULT_ACCOUNT_PAGE_SIZE),
})

/** The search of the page as its route reads the address, each default applied. */
export type AccountSearchParams = z.output<typeof AccountSearchSchema>

/**
 * Where the page's list comes from, as the contract's `console.users.list` reads it: the platform's
 * `accounts.list`, the search text from the address's `q`, a page at a time; it is read again
 * when one of them changes.
 */
export const ACCOUNTS_LIST_SOURCE = {
  platform: 'accounts.list',
  params: { q: { search: 'q' } },
  paged: true,
} as const
