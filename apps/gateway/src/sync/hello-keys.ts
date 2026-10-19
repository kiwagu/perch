/**
 * The keys of a device's hello: accepted as they came, renewed, or taken from the pair parked
 * for the device, and the device's row they are bound to.
 */

import { err, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

import type { AuthTokens, AuthUser, DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import type { DeviceBinding, DeviceSessions } from '../auth/device-sessions'
import {
  type DeviceTokens,
  grantIdOf,
  type IdentitySessions,
  keysRefused,
  type RenewalGate,
} from '../auth/identity-sessions'
import { issuedAtOf } from '../auth/token-claims'

/**
 * The close code of a hello whose renewal a limit refused: try again later (RFC 6455). The client
 * ends its channel only on 4000, 4001, 4400 and 4401, and reconnects with its backoff after any
 * other close, so the device keeps its keys and says hello again.
 */
export const TRY_AGAIN_LATER = 1013

/**
 * Keys a device's hello was accepted with: the identity, the pair the device holds once the
 * hello is through, whether that pair is one the device does not hold yet (renewed, or parked
 * for it), which it must be sent, and the refresh key a renewal at this hello spent.
 */
export interface Accepted {
  readonly identity: AuthUser
  readonly tokens: AuthTokens
  readonly deliver: DeviceTokens | undefined
  readonly spent: string | undefined
}

/**
 * The keys of the hello, accepted: as they came, renewed with the refresh key, or, when the
 * database refused the refresh key because a renewal the device never saw spent it, the pair
 * parked for the device and that key. A pair the device does not hold yet is to be delivered.
 * Every renewal asks `renewal` first; one it refuses fails `data:RATE_LIMITED`, nothing spent.
 * Keys the database could not judge leave the parked pair where it is, and a parked pair it could
 * not judge is parked again: either waits for a hello the database can answer.
 */
export async function acceptKeys(
  sessions: Pick<IdentitySessions, 'authenticate' | 'park' | 'parked'>,
  hello: {
    readonly device: string
    readonly access: string
    readonly refresh?: string | undefined
  },
  renewal: RenewalGate,
): Promise<Result<Accepted, DataError>> {
  const { device, access, refresh } = hello
  const authenticated = await (refresh === undefined
    ? sessions.authenticate({ access })
    : sessions.authenticate({ access, refresh }, renewal))

  if (authenticated.isOk()) {
    const value = authenticated.value

    return ok({
      identity: value.identity,
      tokens: value.tokens,
      deliver: value.renewed ? value.tokens : undefined,
      spent: value.renewed ? refresh : undefined,
    })
  }

  // Keys the database could not judge were not refused: nothing sends them to a parked pair.
  if (refresh === undefined || !keysRefused(authenticated.error)) {
    return err(authenticated.error)
  }

  const parked = sessions.parked({ device, refresh })

  if (!parked) {
    return err(authenticated.error)
  }

  const { identity, tokens } = parked
  const resumed = await sessions.authenticate(tokens, renewal)

  if (resumed.isErr() && !keysRefused(resumed.error)) {
    sessions.park({ identity, device, spentRefresh: refresh, tokens })
  }

  // The parked pair is new to the device, and so is a pair its access token had to be renewed to.
  return resumed.map(
    (value): Accepted => ({
      identity: value.identity,
      tokens: value.tokens,
      deliver: value.renewed ? value.tokens : tokens,
      spent: value.renewed ? tokens.refresh : undefined,
    }),
  )
}

/**
 * Binds the hello to its device's row: a renewal moves the row from the spent grant to the new
 * one (only while the row holds the spent grant and is not signed out), any other hello reads it.
 * The access token the hello was accepted with (renewed, parked or as it came) must belong to the
 * row's current session: one issued before it started, or one that names no second it was issued
 * in, is a stale token.
 */
export function bindDevice(
  devices: Pick<DeviceSessions, 'bind' | 'rotate'>,
  input: { readonly identity: IdentityId; readonly device: string; readonly accepted: Accepted },
): ResultAsync<DeviceBinding, DataError> {
  const { identity, device, accepted } = input
  const { spent, deliver } = accepted
  const issuedAt = issuedAtOf(accepted.tokens.access)

  if (issuedAt === undefined) {
    return okAsync({ kind: 'stale-token' })
  }

  if (spent === undefined || deliver === undefined) {
    return devices.bind({ identity, device, issuedAt })
  }

  const from = grantIdOf(spent)
  const to = grantIdOf(deliver.refresh)

  return from === undefined || to === undefined
    ? okAsync({ kind: 'other-grant' })
    : devices.rotate({ identity, device, spent: from, next: to, issuedAt })
}
