import { passkey } from '@better-auth/passkey'
import { APIError } from 'better-auth/api'

import { AUTH_MODELS } from './auth-models'

/** The refusal of a passkey whose authenticator did not verify its user. */
function userNotVerified(): APIError {
  return new APIError('BAD_REQUEST', {
    code: 'USER_NOT_VERIFIED',
    message: 'the authenticator did not verify its user',
  })
}

/**
 * The plugin's hook once it verified a registration, before it keeps the passkey: a passkey whose
 * authenticator did not verify its user (a PIN, a fingerprint, a face) is refused and nothing is
 * kept, so a passkey stands for something its holder knows or is, not only for the device.
 */
export function refuseUnverifiedRegistration(args: {
  readonly verification: { readonly registrationInfo?: { readonly userVerified: boolean } }
}): void {
  if (args.verification.registrationInfo?.userVerified !== true) {
    throw userNotVerified()
  }
}

/**
 * The plugin's hook once it verified a sign-in's signature, before it writes a session: a sign-in
 * whose authenticator did not verify its user is refused, so the passkey had to be unlocked.
 */
export function refuseUnverifiedAuthentication(args: {
  readonly verification: { readonly authenticationInfo: { readonly userVerified: boolean } }
}): void {
  if (!args.verification.authenticationInfo.userVerified) {
    throw userNotVerified()
  }
}

/**
 * Better Auth's passkey plugin as the gateway runs it, for the front at `publicUrl`: a passkey is
 * bound to the front's own host (`rpID`) and origin, named for Perch, and kept in the directory's
 * `passkey` table. Every passkey is a discoverable credential, so the guest sign-in, whose options
 * name no credential, can find it, and asks for its user's verification at its registration; the
 * plugin's hooks refuse a registration or a sign-in whose authenticator did not verify its user,
 * since the plugin itself does not require it.
 */
export function passkeyPlugin(publicUrl: string) {
  const front = new URL(publicUrl)

  return passkey({
    rpID: front.hostname,
    rpName: 'Perch',
    origin: front.origin,
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    registration: { afterVerification: refuseUnverifiedRegistration },
    authentication: { afterVerification: refuseUnverifiedAuthentication },
    schema: { passkey: AUTH_MODELS.passkey },
  })
}
