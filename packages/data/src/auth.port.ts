import type { IdentityId } from '@workspace/ids'

/** The signed-in identity: the account's id and the email it signs in with. */
export interface AuthUser {
  readonly id: IdentityId
  readonly email: string
}

/** What an account is signed up with: its email, its password and the account's own name. */
export interface SignUpInput {
  readonly email: string
  readonly password: string
  readonly name: string
}

export interface SignInInput {
  readonly email: string
  readonly password: string
}
