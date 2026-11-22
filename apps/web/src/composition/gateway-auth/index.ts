/**
 * Sign-up, sign-in, the verification of an email and the sign-out of a session token at the
 * gateway over HTTP. A sign-up signs nothing in: it creates the account and has its verification
 * mail sent. A sign-in or verification names the device; the gateway answers a sign-in, and an
 * email's first verification, with the account and a session token, which the device keeps and
 * presents on every route and when its sync channel says hello. A token the device could not have
 * the gateway sign out while it was offline is signed out on its own later.
 */

export type { DeletedAccount } from './account-deletion'
export type {
  AccountSession,
  CodeConfirmation,
  Fetcher,
  GatewayAuth,
  PasskeyAssertion,
} from './auth.port'
export { gatewayAuth } from './client'
export type { EmailConfirmation } from './email-confirmation'
export type { PasskeyOptions } from './passkey-sign-in'
export type { PasswordReset } from './password-reset'
export type {
  AccountSignedUpAs,
  NamedDevice,
  SignedInDevice,
  SignInAnswer,
  StepAnswer,
} from './signed-in'
export type { EmailVerification, VerifiedAccount } from './verification'
