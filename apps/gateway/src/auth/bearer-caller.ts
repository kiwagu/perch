import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'

import type { DeviceSessions } from './device-sessions'
import { type IdentitySessions, keysRefused } from './identity-sessions'
import { issuedAtOf } from './token-claims'

/** The access token in an `Authorization` header. */
const BEARER = /^Bearer +(\S+)$/i

/** The header a device names itself in on every call with an access token. */
export const DEVICE_HEADER = 'X-Perch-Device'

/**
 * Who a call with an access token comes from: the identity the token signs in and the device
 * it names, whose session is live; or why the call is refused.
 */
export type BearerCaller =
  | { readonly kind: 'caller'; readonly identity: IdentityId; readonly device: string }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'bad-request' }
  | { readonly kind: 'failed'; readonly error: DataError }

/** The access token the request carries as `Authorization: Bearer <access>`, if it does. */
export function bearerToken(request: Request): string | undefined {
  return BEARER.exec(request.headers.get('Authorization') ?? '')?.[1]
}

/**
 * Who the request comes from: the device it names in `X-Perch-Device` must follow the protocol's
 * device id (checked first, before any call to the database), its access token must sign an
 * identity in (a refresh key is not taken), and that device of the identity must have a live
 * session the token belongs to. A device signed out from another one is refused at once, though
 * its access token still works, and so is a token issued before the device's session started
 * (one of an earlier session the device signed in again after). A token the database could not
 * judge is no refusal: the call failed.
 */
export async function bearerCaller(
  sessions: Pick<IdentitySessions, 'authenticate'>,
  devices: Pick<DeviceSessions, 'bind'>,
  request: Request,
): Promise<BearerCaller> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (!device.success) {
    return { kind: 'bad-request' }
  }

  const access = bearerToken(request)

  if (access === undefined) {
    return { kind: 'unauthorized' }
  }

  const authenticated = await sessions.authenticate({ access })

  if (authenticated.isErr()) {
    return keysRefused(authenticated.error)
      ? { kind: 'unauthorized' }
      : { kind: 'failed', error: authenticated.error }
  }

  const identity = authenticated.value.identity.id
  // The database verified the token: what it says of when it was issued can be read as it is.
  const issuedAt = issuedAtOf(access)

  if (issuedAt === undefined) {
    return { kind: 'unauthorized' }
  }

  const binding = await devices.bind({ identity, device: device.data, issuedAt })

  if (binding.isErr()) {
    return { kind: 'failed', error: binding.error }
  }

  return binding.value.kind === 'bound'
    ? { kind: 'caller', identity, device: device.data }
    : { kind: 'unauthorized' }
}

/**
 * The answer to a call whose access token signs nobody in, or whose device has no live session:
 * 401 `unauthorized`, naming the scheme the call must authenticate with.
 */
export function bearerRefused(): Response {
  return Response.json(
    { code: 'unauthorized' },
    { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
  )
}
