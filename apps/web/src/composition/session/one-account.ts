/**
 * One account per browser: while an identity is signed in on it, in any tab, no other one signs
 * in until that one signed out. The tabs follow the saved identity, so a tab left on the sign-in
 * page moves to the account another tab signed in; a sign-in that still finds another account
 * saved is refused, so the first one's keys and databases are never left behind unseen.
 */

import { dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { type KeyValueStorage, savedIdentity } from '../storage'

/** The refusal of a sign-in while another account is signed in on this browser. */
export const otherAccountSignedIn = () =>
  dataError('data:OTHER_ACCOUNT', 'another account is signed in on this browser')

const sameEmail = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** Whether an account other than the one of `email` is signed in on this browser. */
export function otherAccountSaved(storage: KeyValueStorage, email: string): boolean {
  const saved = savedIdentity(storage)

  return saved !== undefined && !sameEmail(saved.email, email)
}

/** Whether an identity other than `identity` is signed in on this browser. */
export function otherIdentitySaved(storage: KeyValueStorage, identity: IdentityId): boolean {
  const saved = savedIdentity(storage)

  return saved !== undefined && saved.id !== identity
}
