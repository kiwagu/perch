import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import { addressKey } from './address-key'
import { type Allowance, FixedWindow } from './fixed-window'
import {
  ADDRESS_INVITES,
  ADDRESS_LINK_ATTEMPTS,
  ADDRESS_MAILS,
  ADDRESS_ORGANISATIONS,
  CREDENTIAL_CHECKS,
  EMAIL_RESET_MAILS,
  EMAIL_VERIFICATION_MAILS,
  FAILED_SIGN_INS,
  IDENTITY_DELETION_REQUESTS,
  IDENTITY_EMAIL_CHANGES,
  IDENTITY_INVITES,
  IDENTITY_ORGANISATIONS,
} from './windows'

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
 * address at a reset link, a confirmation link, a deletion link and an invitation's link, the
 * invitations of each inviting identity and each client address (each also one of the client
 * address's mails), and the organisations each identity and each client address create.
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
  private readonly invitationAttempts: FixedWindow
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
    this.invitationAttempts = new FixedWindow({ ...ADDRESS_LINK_ATTEMPTS, clock: options.clock })
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

  /** Takes one attempt of the client at `address` at an invitation's link, before anything is read. */
  invitationLink(address: string): Allowance {
    return this.invitationAttempts.take(addressKey(address))
  }

  /**
   * Takes one invitation of `identity` from the client at `address`, before the service is asked:
   * one of the address's mails, then one of the identity's invitations, then, only when the
   * identity's limit allows it, one of the address's invitations. The address's mail is given
   * back when either invitation window refuses, so a refused invitation costs no mail and a mail
   * the address refuses moves no invitation window.
   */
  inviteMail(identity: IdentityId, address: string): Allowance {
    return this.mail(address, () => {
      const ofIdentity = this.identityInvites.take(identity)

      return ofIdentity.allowed ? this.addressInvites.take(addressKey(address)) : ofIdentity
    })
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
