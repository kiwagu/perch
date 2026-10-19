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
 * Failed sign-ins per email, 10 per 15 minutes, a sign-in under way counted as one until the
 * database answers, cleared by a successful sign-in: online guessing against one account is held
 * to about 960 tries a day, refused before the database is asked, parallel guesses included. An
 * email is counted exactly as the database matches an account's, its case included.
 */
export const FAILED_SIGN_INS = { limit: 10, windowMs: 15 * minute } as const

/**
 * Renewals per device, 10 per 15 minutes: a device renews once per expired 15-minute access token,
 * at its next hello; a hello whose socket closes before the new pair arrives costs one more (the
 * spent key presented again), so 10 covers five flaps of a bad network in one window.
 */
export const DEVICE_RENEWALS = { limit: 10, windowMs: 15 * minute } as const

/**
 * Renewals per client address, 120 per minute: everyone behind one NAT renews when they open
 * their laptops after the access tokens expired overnight, and 120 a minute lets about 500
 * devices through in five minutes, a device the address refused retrying with its reconnect
 * backoff at no cost to its own limit; one guessing address is held to 2 lookups a second.
 */
export const ADDRESS_RENEWALS = { limit: 120, windowMs: minute } as const

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

export interface RequestLimitsOptions {
  readonly clock: Clock
}

/**
 * What the database answered a sign-in: wrong credentials (`failed`), signed in (`succeeded`), or
 * nothing it could judge (`unjudged`, the database could not be reached).
 */
export type SignInOutcome = 'failed' | 'succeeded' | 'unjudged'

/**
 * A sign-in of an email let through, to settle once the database answered it (a second settle
 * changes nothing); or its refusal.
 */
export type SignInAttempt =
  | { readonly allowed: true; settle(outcome: SignInOutcome): void }
  | { readonly allowed: false; readonly retryAfterMs: number }

/**
 * The gateway's request limits, fixed windows in this process's memory (several gateway processes
 * each keep their own): the credential checks of each client address, the failed sign-ins of
 * each email, the refresh-key renewals of each device and each client address, the invitations of
 * each inviting identity and each client address, and the organisations each identity and each
 * client address create.
 */
export class RequestLimits {
  private readonly credentialChecks: FixedWindow
  private readonly failedSignIns: FixedWindow
  private readonly deviceRenewals: FixedWindow
  private readonly addressRenewals: FixedWindow
  private readonly identityInvites: FixedWindow
  private readonly addressInvites: FixedWindow
  private readonly identityOrganisations: FixedWindow
  private readonly addressOrganisations: FixedWindow

  constructor(options: RequestLimitsOptions) {
    this.credentialChecks = new FixedWindow({ ...CREDENTIAL_CHECKS, clock: options.clock })
    this.failedSignIns = new FixedWindow({ ...FAILED_SIGN_INS, clock: options.clock })
    this.deviceRenewals = new FixedWindow({ ...DEVICE_RENEWALS, clock: options.clock })
    this.addressRenewals = new FixedWindow({ ...ADDRESS_RENEWALS, clock: options.clock })
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
   * the database could not judge gives the place back. The email is counted as it came, its case
   * included: the database matches an account's email exactly, so a case variant is another
   * account, and its success must not clear this one's failures.
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
   * Takes one renewal of `device` from the client at `address`, before its refresh key is
   * exchanged; the address is charged only when the device's limit allows it, and a renewal the
   * address's limit refuses gives the device's attempt back, so the devices that wait behind one
   * busy address keep their own limit for when it lets them through.
   */
  renewal(address: string, device: string): Allowance {
    const ofDevice = this.deviceRenewals.reserve(device)

    if (!ofDevice.allowed) {
      return ofDevice
    }

    const ofAddress = this.addressRenewals.take(addressKey(address))

    if (!ofAddress.allowed) {
      ofDevice.giveBack()
    }

    return ofAddress
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
}
