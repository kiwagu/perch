/**
 * The roles a device holds, as the router, the frame and the checks read them: `guest` while
 * nobody is signed in on it, else `identity` and, beside it, every other role that applies to
 * the signed-in account (its role in the current organisation, a role of the platform). `guest`
 * and `identity` are the two roles of which a device holds exactly one; every other role is held
 * beside `identity`, never alone. A binding's or an anchor's `roles` admit a device that holds
 * one of them.
 */

/** The role of a device nobody is signed in on. */
export const GUEST = 'guest'

/** The role of a device an account is signed in on, whatever else it holds. */
export const IDENTITY = 'identity'

/** The roles a device holds: `guest` alone, else `identity` and each of `others` but `guest`. */
export const heldRoles = (signedIn: boolean, others: Iterable<string> = []): ReadonlySet<string> =>
  new Set(signedIn ? [IDENTITY, ...[...others].filter((role) => role !== GUEST)] : [GUEST])

/** Whether `roles` (a binding's, an anchor's) admit a device that holds `held`. */
export const admits = (roles: readonly string[], held: ReadonlySet<string>): boolean =>
  roles.some((role) => held.has(role))
