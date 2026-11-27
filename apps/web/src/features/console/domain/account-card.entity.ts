/**
 * The account an operator's card shows, as the address of `console.account` names it (`?id=...`):
 * the identity id of the account, the one its entry in the accounts list carries.
 */

import { type IdentityId, idSchemas } from '@workspace/ids'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { z } from '@workspace/zod'

export const AccountCardSearchSchema = z.object({
  id: z.string().min(1).max(CONTRACT_VALUES.id.maxLength).optional(),
})

/** The search of the card as its route reads the address. */
export type AccountCardSearch = z.output<typeof AccountCardSearchSchema>

/**
 * Where the card's account comes from, as the contract's `console.account.section` reads it: the
 * platform's `accounts.read` of the id in the address; it is read again when the id changes.
 */
export const ACCOUNT_SECTION_SOURCE = {
  platform: 'accounts.read',
  params: { id: { search: 'id' } },
} as const

/**
 * The account the address names: none when it names none, or names something that is no
 * identity id, which no account has.
 */
export function accountIdOf(search: AccountCardSearch): IdentityId | undefined {
  const parsed = idSchemas.identity.schema.safeParse(search.id)

  return parsed.success ? parsed.data : undefined
}
