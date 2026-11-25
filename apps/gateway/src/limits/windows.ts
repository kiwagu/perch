/**
 * The windows of the gateway's request limits: how many of each a key may make in how long. A
 * window the contract states as an invariant's values is read from it (`CONTRACT_INVARIANTS`), so
 * the contract's number is the one enforced; the others are the gateway's own.
 */

import { CONTRACT_INVARIANTS } from '@workspace/kernel'

const second = 1000
const minute = 60 * second

/**
 * Credential checks (sign-ups and sign-ins together) per client address, the contract's
 * `credential-checks`: each is one argon2 run, so one address stays at a few percent of a core,
 * even across a window's edge.
 */
export const CREDENTIAL_CHECKS = CONTRACT_INVARIANTS['credential-checks']

/**
 * Failed sign-ins per email, the contract's `failed-sign-ins`, a sign-in under way counted as one
 * until it is answered, cleared by a successful sign-in: online guessing against one account is
 * held to a few hundred tries a day, refused before the password is checked, parallel guesses
 * included. An email is counted in lower case, as the directory matches an account's, so an
 * address in any case shares one limit.
 */
export const FAILED_SIGN_INS = CONTRACT_INVARIANTS['failed-sign-ins']

const invitations = CONTRACT_INVARIANTS['invitation-attempts']

/**
 * Invitations per inviting identity, the contract's `invitation-attempts` (`limit`), every attempt
 * counted, an unknown email's included: an admin onboarding many people waits for the next window,
 * and probing which emails have an account stays slow.
 */
export const IDENTITY_INVITES = {
  limit: invitations.limit,
  windowMs: invitations.windowMs,
} as const

/**
 * Invitations per client address, the contract's `invitation-attempts` (`addressLimit`), in a
 * window of its own as long as the identity's: one address cannot farm identities to multiply the
 * per-identity limit.
 */
export const ADDRESS_INVITES = {
  limit: invitations.addressLimit,
  windowMs: invitations.windowMs,
} as const

/** Organisations created per identity, 10 per hour: each creation provisions a database. */
export const IDENTITY_ORGANISATIONS = { limit: 10, windowMs: 60 * minute } as const

/**
 * Organisations created per client address, 30 per hour: one address cannot farm identities to
 * provision databases beyond the per-identity limit.
 */
export const ADDRESS_ORGANISATIONS = { limit: 30, windowMs: 60 * minute } as const

/**
 * Mails per client address, the contract's `address-mails`: sign-ups, resends of the verification
 * mail, reset mails, the confirmations of a new email, the deletion mails and the invitations
 * together, every attempt counted whatever the email, so one client makes few such mails go out
 * (the credential limit alone would allow many times more sign-ups). The e2e suite stays under it
 * on a gateway restarted for the run, from one address per Playwright worker: the e2e stand's
 * front passes on the address each worker claims.
 */
export const ADDRESS_MAILS = CONTRACT_INVARIANTS['address-mails']

/**
 * Resends of the verification mail per email, 3 per 15 minutes, whatever the email (an unknown or
 * verified one too, so the limit tells nothing about accounts): a mailbox gets at most 12 resends
 * an hour from everyone together.
 */
export const EMAIL_VERIFICATION_MAILS = { limit: 3, windowMs: 15 * minute } as const

/**
 * Reset mails per email, 3 per 15 minutes, whatever the email (an unknown one too, so the limit
 * tells nothing about accounts): a mailbox gets at most 12 reset mails an hour from everyone
 * together.
 */
export const EMAIL_RESET_MAILS = { limit: 3, windowMs: 15 * minute } as const

/** Changes of the email per identity, the contract's `email-changes`, each one mail to the new email. */
export const IDENTITY_EMAIL_CHANGES = CONTRACT_INVARIANTS['email-changes']

/** Requests to delete the account per identity, 3 per 15 minutes, each one mail to its email. */
export const IDENTITY_DELETION_REQUESTS = { limit: 3, windowMs: 15 * minute } as const

/**
 * Attempts at one kind of link per client address, the contract's `address-attempts`, refused or
 * not: the reset of a password, the confirmation of a new email, the deletion of an account and
 * the reading of an invitation's link each count on their own. A link's token is too long to
 * guess, so the limit only keeps one client from hammering the directory.
 */
export const ADDRESS_LINK_ATTEMPTS = CONTRACT_INVARIANTS['address-attempts']
