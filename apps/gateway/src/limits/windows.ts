/** The windows of the gateway's request limits: how many of each a key may make in how long. */

const second = 1000
const minute = 60 * second

/**
 * Credential checks (sign-ups and sign-ins together) per client address, 20 per 10 s: each is one
 * argon2 run, so one address stays at a few percent of a core, even across a window's edge.
 */
export const CREDENTIAL_CHECKS = { limit: 20, windowMs: 10 * second } as const

/**
 * Failed sign-ins per email, 10 per 15 minutes, a sign-in under way counted as one until it is
 * answered, cleared by a successful sign-in: online guessing against one account is held to about
 * 960 tries a day, refused before the password is checked, parallel guesses included. An email is
 * counted in lower case, as the directory matches an account's, so an address in any case shares
 * one limit.
 */
export const FAILED_SIGN_INS = { limit: 10, windowMs: 15 * minute } as const

/**
 * Invitations per inviting identity, 30 per 10 minutes, every attempt counted, an unknown email's
 * included: an admin onboarding 50 people waits about 10 minutes for the last 20, and probing
 * which emails have an account stays slow.
 */
export const IDENTITY_INVITES = { limit: 30, windowMs: 10 * minute } as const

/**
 * Invitations per client address, 60 per 10 minutes: one address cannot farm identities to
 * multiply the per-identity limit.
 */
export const ADDRESS_INVITES = { limit: 60, windowMs: 10 * minute } as const

/** Organisations created per identity, 10 per hour: each creation provisions a database. */
export const IDENTITY_ORGANISATIONS = { limit: 10, windowMs: 60 * minute } as const

/**
 * Organisations created per client address, 30 per hour: one address cannot farm identities to
 * provision databases beyond the per-identity limit.
 */
export const ADDRESS_ORGANISATIONS = { limit: 30, windowMs: 60 * minute } as const

/**
 * Mails per client address, 200 per 15 minutes: sign-ups, resends of the verification mail, reset
 * mails, the confirmations of a new email, the deletion mails and the invitations together, every
 * attempt counted whatever the email: one client can make at most 200 such mails go out per
 * quarter hour (the credential limit alone would allow 1,800 sign-ups). The e2e suite makes about
 * 150 go out per run, on a gateway restarted for the run, from one address per Playwright worker:
 * the e2e stand's front passes on the address each worker claims.
 */
export const ADDRESS_MAILS = { limit: 200, windowMs: 15 * minute } as const

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

/** Changes of the email per identity, 3 per 15 minutes, each one mail to the new email. */
export const IDENTITY_EMAIL_CHANGES = { limit: 3, windowMs: 15 * minute } as const

/** Requests to delete the account per identity, 3 per 15 minutes, each one mail to its email. */
export const IDENTITY_DELETION_REQUESTS = { limit: 3, windowMs: 15 * minute } as const

/**
 * Attempts at one kind of link per client address, 20 per 10 minutes, refused or not: the reset of
 * a password, the confirmation of a new email, the deletion of an account and the reading of an
 * invitation's link each count on their own. A link's token is too long to guess, so the limit
 * only keeps one client from hammering the directory.
 */
export const ADDRESS_LINK_ATTEMPTS = { limit: 20, windowMs: 10 * minute } as const
