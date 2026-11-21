import type { IdentityId } from '@workspace/ids'

/** The signed-in identity: the account's id and the email it signs in with. */
export interface AuthUser {
  readonly id: IdentityId
  readonly email: string
}

/**
 * What an account is signed up with: its email, its password, the account's own name, and its
 * language.
 */
export interface SignUpInput {
  readonly email: string
  readonly password: string
  readonly name: string
  /** The language the account's mails speak and its settings start with: one of the app's languages. */
  readonly locale: string
}

export interface SignInInput {
  readonly email: string
  readonly password: string
  /**
   * Confirms a sign-in past the account's limit of devices, which signs out its device seen least
   * recently; without it such a sign-in signs nothing in and answers the outcome `device-limit`
   * at the gateway and session boundaries (the seed client's facade keeps it as the error
   * `data:DEVICE_LIMIT`).
   */
  readonly signOutOldest?: boolean
}

/**
 * What the code step of a sign-in carries from the password step that asked for a code: the
 * gateway's challenge, opaque to the device, and the email typed there, which the code step is
 * judged by.
 */
export interface CodeStep {
  readonly challenge: string
  readonly email: string
}
