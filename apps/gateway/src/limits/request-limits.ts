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

export interface RequestLimitsOptions {
  readonly clock: Clock
}

/** The key an email is counted under: emails are counted whatever their case. */
function emailKey(email: string): string {
  return email.toLowerCase()
}

/**
 * The gateway's request limits, fixed windows in this process's memory (several gateway processes
 * each keep their own): the credential checks of each client address, and the failed sign-ins
 * of each email.
 */
export class RequestLimits {
  private readonly credentialChecks: FixedWindow
  private readonly failedSignIns: FixedWindow

  constructor(options: RequestLimitsOptions) {
    this.credentialChecks = new FixedWindow({ ...CREDENTIAL_CHECKS, clock: options.clock })
    this.failedSignIns = new FixedWindow({ ...FAILED_SIGN_INS, clock: options.clock })
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
}
