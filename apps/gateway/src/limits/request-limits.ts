import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import { addressKey } from './address-key'
import { type Allowance, FixedWindow } from './fixed-window'

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
 * mails, the confirmations of a new email and the deletion mails together, every attempt counted
 * whatever the email:
 * one client can make at most 200 such mails go out per quarter hour (the credential limit alone
 * would allow 1,800 sign-ups). The e2e suite makes about 150 go out per run, on a gateway
 * restarted for the run, from one address per Playwright worker: the e2e stand's front passes on
 * the address each worker claims.
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
 * a password, the confirmation of a new email and the deletion of an account each count on their
 * own. A link's token is too
 * long to guess, so the limit only keeps one client from hammering the directory.
 */
export const ADDRESS_LINK_ATTEMPTS = { limit: 20, windowMs: 10 * minute } as const

export interface RequestLimitsOptions {
  readonly clock: Clock
}

/**
 * What a sign-in was answered: wrong credentials (`failed`), signed in (`succeeded`), or anything
 * that judged no password (`unjudged`: a request refused for another reason, or a failure).
 */
export type SignInOutcome = 'failed' | 'succeeded' | 'unjudged'

/**
 * A sign-in of an email let through, to settle once it was answered (a second settle changes
 * nothing); or its refusal.
 */
export type SignInAttempt =
  | { readonly allowed: true; settle(outcome: SignInOutcome): void }
  | { readonly allowed: false; readonly retryAfterMs: number }

/**
 * The gateway's request limits, fixed windows in this process's memory (several gateway processes
 * each keep their own): the credential checks of each client address, the failed sign-ins of
 * each email, the mails of each client address, the resends and the reset mails of each email,
 * the email changes and the deletion requests of each identity, the attempts of each client
 * address at a reset link, a confirmation link and a deletion link, the invitations of each
 * inviting identity and each client address, and the organisations each identity and each client
 * address create.
 */
export class RequestLimits {
  private readonly credentialChecks: FixedWindow
  private readonly failedSignIns: FixedWindow
  private readonly addressMails: FixedWindow
  private readonly emailVerificationMails: FixedWindow
  private readonly emailResetMails: FixedWindow
  private readonly identityEmailChanges: FixedWindow
  private readonly identityDeletionRequests: FixedWindow
  private readonly resetAttempts: FixedWindow
  private readonly confirmationAttempts: FixedWindow
  private readonly deletionAttempts: FixedWindow
  private readonly identityInvites: FixedWindow
  private readonly addressInvites: FixedWindow
  private readonly identityOrganisations: FixedWindow
  private readonly addressOrganisations: FixedWindow

  constructor(options: RequestLimitsOptions) {
    this.credentialChecks = new FixedWindow({ ...CREDENTIAL_CHECKS, clock: options.clock })
    this.failedSignIns = new FixedWindow({ ...FAILED_SIGN_INS, clock: options.clock })
    this.addressMails = new FixedWindow({ ...ADDRESS_MAILS, clock: options.clock })
    this.emailVerificationMails = new FixedWindow({
      ...EMAIL_VERIFICATION_MAILS,
      clock: options.clock,
    })
    this.emailResetMails = new FixedWindow({ ...EMAIL_RESET_MAILS, clock: options.clock })
    this.identityEmailChanges = new FixedWindow({
      ...IDENTITY_EMAIL_CHANGES,
      clock: options.clock,
    })
    this.identityDeletionRequests = new FixedWindow({
      ...IDENTITY_DELETION_REQUESTS,
      clock: options.clock,
    })
    this.resetAttempts = new FixedWindow({ ...ADDRESS_LINK_ATTEMPTS, clock: options.clock })
    this.confirmationAttempts = new FixedWindow({ ...ADDRESS_LINK_ATTEMPTS, clock: options.clock })
    this.deletionAttempts = new FixedWindow({ ...ADDRESS_LINK_ATTEMPTS, clock: options.clock })
    this.identityInvites = new FixedWindow({ ...IDENTITY_INVITES, clock: options.clock })
    this.addressInvites = new FixedWindow({ ...ADDRESS_INVITES, clock: options.clock })
    this.identityOrganisations = new FixedWindow({
      ...IDENTITY_ORGANISATIONS,
      clock: options.clock,
    })
    this.addressOrganisations = new FixedWindow({ ...ADDRESS_ORGANISATIONS, clock: options.clock })
  }

  /** Takes one credential check (a sign-up or a sign-in) of the client at `address`. */
  credentials(address: string): Allowance {
    return this.credentialChecks.take(addressKey(address))
  }

  /**
   * Lets a sign-in of `email` through while its failed sign-ins and those under way are below the
   * limit, holding a place for it until it is settled: a failure keeps the place, a success
   * forgets the email's window (its failures and the places of those under way), and an answer
   * that judged no password gives the place back. The email comes in lower case, as the auth
   * mount takes it and the directory matches it, so a sign-in in any case counts against one
   * account.
   */
  signInAttempt(email: string): SignInAttempt {
    const reserved = this.failedSignIns.reserve(email)

    if (!reserved.allowed) {
      return reserved
    }

    let settled = false

    return {
      allowed: true,
      settle: (outcome) => {
        // A sign-in is settled once: a second settle of it changes nothing.
        if (settled) {
          return
        }

        settled = true

        if (outcome === 'succeeded') {
          this.failedSignIns.forget(email)
        } else if (outcome === 'unjudged') {
          reserved.giveBack()
        }
      },
    }
  }

  /**
   * Takes one verification mail of the client at `address` before anything is asked: a sign-up
   * (no `email`) or a resend to `email` (in lower case), which also takes one of that email's
   * resends. The address's place is reserved first and given back when the email refuses, so a
   * request the address refuses moves no email's counter, and one the email refuses costs the
   * address nothing.
   */
  verificationMail(address: string, email?: string): Allowance {
    return email === undefined
      ? this.mail(address)
      : this.mail(address, () => this.emailVerificationMails.take(email))
  }

  /**
   * Takes one reset mail of `email` (in lower case) from the client at `address`, before anything
   * is asked: one of the address's mails and one of the email's reset mails, the address's place
   * given back when the email refuses.
   */
  resetMail(address: string, email: string): Allowance {
    return this.mail(address, () => this.emailResetMails.take(email))
  }

  /**
   * Takes one change of `identity`'s email from the client at `address`, before anything is
   * asked: one of the address's mails and one of the identity's changes, the address's place
   * given back when the identity refuses.
   */
  emailChangeMail(address: string, identity: IdentityId): Allowance {
    return this.mail(address, () => this.identityEmailChanges.take(identity))
  }

  /**
   * Takes one request to delete `identity`'s account from the client at `address`, before anything
   * is asked: one of the address's mails and one of the identity's requests, the address's place
   * given back when the identity refuses.
   */
  deletionMail(address: string, identity: IdentityId): Allowance {
    return this.mail(address, () => this.identityDeletionRequests.take(identity))
  }

  /** Takes one attempt of the client at `address` at a reset link, before anything is read. */
  passwordReset(address: string): Allowance {
    return this.resetAttempts.take(addressKey(address))
  }

  /** Takes one attempt of the client at `address` at a confirmation link, before anything is read. */
  emailConfirmation(address: string): Allowance {
    return this.confirmationAttempts.take(addressKey(address))
  }

  /** Takes one attempt of the client at `address` at a deletion link, before anything is read. */
  accountDeletion(address: string): Allowance {
    return this.deletionAttempts.take(addressKey(address))
  }

  /**
   * Takes one invitation attempt of `identity` from the client at `address`, before the service is
   * asked; the address is charged only when the identity's limit allows it.
   */
  invite(identity: IdentityId, address: string): Allowance {
    const ofIdentity = this.identityInvites.take(identity)

    return ofIdentity.allowed ? this.addressInvites.take(addressKey(address)) : ofIdentity
  }

  /**
   * Takes one organisation creation of `identity` from the client at `address`, before the
   * organisation is provisioned; the address is charged only when the identity's limit allows it.
   */
  createOrganisation(identity: IdentityId, address: string): Allowance {
    const ofIdentity = this.identityOrganisations.take(identity)

    return ofIdentity.allowed ? this.addressOrganisations.take(addressKey(address)) : ofIdentity
  }

  /**
   * Takes one of the mails of the client at `address`, then what `also` takes (an email's or an
   * identity's own limit): the address's place is reserved first and given back when `also`
   * refuses, so a mail the address refuses moves no other counter, and one the other limit refuses
   * costs the address nothing.
   */
  private mail(address: string, also?: () => Allowance): Allowance {
    const ofAddress = this.addressMails.reserve(addressKey(address))

    if (!ofAddress.allowed || also === undefined) {
      return ofAddress.allowed ? { allowed: true } : ofAddress
    }

    const ofOther = also()

    if (!ofOther.allowed) {
      ofAddress.giveBack()
    }

    return ofOther
  }
}
