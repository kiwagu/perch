/**
 * A sign-in on this browser: the id it mints before its first write, which names every record it
 * keeps, and the pointer to the current one.
 */

import type { IdentityId } from '@workspace/ids'

/**
 * The id of the sign-in current on this browser; the tabs follow it. Written by a sign-in only,
 * once its records are saved, and never removed: it names no one, and after a sign-out it names
 * a sign-in whose records are gone, which is nobody signed in.
 */
export const CURRENT_KEY = 'perch.session.current'

/** The id of one sign-in on this browser: minted before its first write, and never used again. */
export type SignInId = string

/** A new sign-in's id. */
export function newSignInId(): SignInId {
  return crypto.randomUUID()
}

/**
 * A sign-in this browser keeps: its id, the identity it signed in and the session token the
 * gateway gave it. Whatever ends it names it so, as it began.
 */
export interface KeptSession {
  readonly signIn: SignInId
  readonly identity: IdentityId
  readonly token: string
}

/** Whose a record kept under a sign-in's id is: that sign-in, and the identity it signed in. */
export type SignInOwner = Pick<KeptSession, 'signIn' | 'identity'>
