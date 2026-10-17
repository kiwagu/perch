import type { ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import { token } from '@workspace/di'
import type { Membership } from '@workspace/replica/protocol'

export interface SignOutOptions {
  /** Sign out even though this device holds changes the gateway has not received; they are lost. */
  readonly forgetUnsent?: boolean
}

/**
 * A word the session leaves for the sign-in page: `resend-after-sign-in` when the device was
 * signed out (its keys refused, or a write landing during its sign-out) while it held changes it
 * had not sent; they are kept on the device, and signing in again as the same identity sends them.
 */
export type SessionNotice = 'resend-after-sign-in'

/** A change the gateway refused and this device undid: what the shell tells the user about. */
export interface PushRejection {
  readonly region: string
  readonly batch: number
  readonly reason: string
  readonly detail: string
}

/** The signed-in user of the application and the transitions between users. */
export interface SessionPort {
  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError>
  signIn(input: SignInInput): ResultAsync<AuthUser, DataError>
  /**
   * Signs this device out: `signed-out` once its changes reached the gateway (or were given up
   * with `forgetUnsent`) and its local data is gone; `needs-confirmation`, changing nothing,
   * when changes could not be sent and signing out would lose them.
   */
  signOut(options?: SignOutOptions): ResultAsync<'signed-out' | 'needs-confirmation', DataError>
  current(): AuthUser | undefined
  subscribe(listener: (user: AuthUser | undefined) => void): () => void
  /** Resolves once every write so far is durable and projected; reports a write that is not durable. */
  flush(): ResultAsync<void, DataError>
  /** The word the last session left for the sign-in page, until `clearNotice`. */
  notice(): SessionNotice | undefined
  clearNotice(): void
  /** The organisations the signed-in identity belongs to, as the gateway last said; none while nobody is signed in. */
  memberships(): readonly Membership[]
  /** Hears the memberships or the current organisation change, a sign-in or sign-out included. */
  subscribeMemberships(listener: () => void): () => void
  /**
   * The organisation the tenant region's reads and writes go to: the one selected last on this
   * browser while the identity belongs to it, otherwise the first by key; none without memberships.
   */
  currentTenant(): Membership | undefined
  /** Makes the organisation `key` current and keeps the choice on this browser; a key of no membership changes nothing. */
  selectTenant(key: string): void
  /** Hears each change the gateway refused and this device undid. */
  subscribeRejections(listener: (rejection: PushRejection) => void): () => void
}

export const SESSION = token<SessionPort>('Session')
