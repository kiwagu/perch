/**
 * Signing out, by the person's own request or forced by the gateway: the session decides how its
 * space ends, behind the write barrier, and the space ends so, the sign-in page told why.
 */

export {
  type ElsewhereNotice,
  type ForcedSignOut,
  SessionSignOut,
  type SessionSignOutOptions,
  type SignOutOutcome,
} from './session'
