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
 * Failed sign-ins per email, 10 per 15 minutes, cleared by a successful sign-in: online guessing
 * against one account is held to about 960 tries a day, refused before the database is asked.
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
 * devices through in five minutes; one guessing address is held to 2 lookups a second.
 */
export const ADDRESS_RENEWALS = { limit: 120, windowMs: minute } as const

export interface RequestLimitsOptions {
  readonly clock: Clock
}

/** The key an email is counted under: emails are counted whatever their case. */
function emailKey(email: string): string {
  return email.toLowerCase()
}

/**
 * The gateway's request limits, fixed windows in this process's memory (several gateway processes
 * each keep their own): the credential checks of each client address, the failed sign-ins of
 * each email, and the refresh-key renewals of each device and each client address.
 */
export class RequestLimits {
  private readonly credentialChecks: FixedWindow
  private readonly failedSignIns: FixedWindow
  private readonly deviceRenewals: FixedWindow
  private readonly addressRenewals: FixedWindow

  constructor(options: RequestLimitsOptions) {
    this.credentialChecks = new FixedWindow({ ...CREDENTIAL_CHECKS, clock: options.clock })
    this.failedSignIns = new FixedWindow({ ...FAILED_SIGN_INS, clock: options.clock })
    this.deviceRenewals = new FixedWindow({ ...DEVICE_RENEWALS, clock: options.clock })
    this.addressRenewals = new FixedWindow({ ...ADDRESS_RENEWALS, clock: options.clock })
  }

  /** Takes one credential check (a sign-up or a sign-in) of the client at `address`. */
  credentials(address: string): Allowance {
    return this.credentialChecks.take(addressKey(address))
  }

  /** Whether `email` may try to sign in, counting nothing. */
  signInAllowed(email: string): Allowance {
    return this.failedSignIns.check(emailKey(email))
  }

  /** Counts a sign-in of `email` the database refused as wrong credentials. */
  signInFailed(email: string): void {
    this.failedSignIns.count(emailKey(email))
  }

  /** Forgets the failed sign-ins of `email`, which just signed in. */
  signInSucceeded(email: string): void {
    this.failedSignIns.forget(emailKey(email))
  }

  /**
   * Takes one renewal of `device` from the client at `address`, before its refresh key is
   * exchanged; the address is charged only when the device's limit allows it.
   */
  renewal(address: string, device: string): Allowance {
    const ofDevice = this.deviceRenewals.take(device)

    return ofDevice.allowed ? this.addressRenewals.take(addressKey(address)) : ofDevice
  }
}
