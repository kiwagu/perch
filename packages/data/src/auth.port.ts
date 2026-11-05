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
}
