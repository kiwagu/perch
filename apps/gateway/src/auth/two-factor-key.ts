import { createOTP } from '@better-auth/utils/otp'
import { symmetricDecrypt } from 'better-auth/crypto'

import type { AuthInstance } from './auth-instance'

/**
 * The key an authenticator app is given as text: the base32 `secret` of the `otpauth://` URI
 * Better Auth answers at an enable; none for a URI that carries none.
 */
export function keyShown(uri: string): string | undefined {
  return new URL(uri).searchParams.get('secret') ?? undefined
}

/**
 * Whether `code` is one the key kept in `encrypted` accepts now: the code of the current step of
 * 30 seconds, or of the one before or after, as Better Auth's own check of a code takes it. The
 * secret is decrypted with Better Auth's key and the code compared by its `createOTP`, as its
 * `/two-factor/verify-totp` does, without the session it replaces while a caller is signed in.
 */
export async function keyAccepts(
  auth: Pick<AuthInstance, '$context'>,
  encrypted: string,
  code: string,
): Promise<boolean> {
  const { secretConfig } = await auth.$context
  const secret = await symmetricDecrypt({ key: secretConfig, data: encrypted })

  return createOTP(secret).verify(code)
}
