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

/**
 * The role sets of the devices `roles` tell apart: `guest` alone, `identity` alone, and `identity`
 * with each other role of `roles`. A device that holds more is admitted whenever one of its roles
 * is, so no larger set tells two lists apart that these do not.
 */
const devicesOf = (roles: readonly string[]): ReadonlySet<string>[] => [
  heldRoles(false),
  heldRoles(true),
  ...roles
    .filter((role) => role !== GUEST && role !== IDENTITY)
    .map((role) => heldRoles(true, [role])),
]

/**
 * Whether `a` admits every device `b` admits, over the devices `roles` (the vocabulary's) let a
 * device hold: `guest` alone, or `identity` with any subset of the others.
 */
export const admitsAllOf = (
  a: readonly string[],
  b: readonly string[],
  roles: readonly string[],
): boolean => devicesOf(roles).every((held) => !admits(b, held) || admits(a, held))

/**
 * Whether two lists of roles admit exactly the same devices: `[identity, member, admin]` equals
 * `[identity]`, since a device that holds `member` or `admin` always holds `identity`.
 */
export const sameAdmission = (
  a: readonly string[],
  b: readonly string[],
  roles: readonly string[],
): boolean => admitsAllOf(a, b, roles) && admitsAllOf(b, a, roles)
