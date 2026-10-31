/**
 * Sign-up, sign-in, the verification of an email and the sign-out of a session token at the
 * gateway over HTTP. A sign-up, sign-in or verification names the device; the gateway answers a
 * sign-in, and an email's first verification, with the account and a session token, which the
 * device keeps and presents on every route and when its sync channel says hello. A token the
 * device could not have the gateway sign out while it was offline is signed out on its own later.
 */

export { type Fetcher, type GatewayAuth, gatewayAuth } from './client'
export type { NamedDevice, SignedInDevice } from './signed-in'
export type { EmailVerification, VerifiedAccount } from './verification'
