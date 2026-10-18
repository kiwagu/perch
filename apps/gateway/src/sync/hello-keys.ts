/**
 * The keys of a device's hello: accepted as they came, renewed, or taken from the pair parked
 * for the device, and the device's row they are bound to.
 */

import { err, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

import type { AuthTokens, AuthUser, DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import type { DeviceBinding, DeviceSessions } from '../auth/device-sessions'
import { type DeviceTokens, grantIdOf, type IdentitySessions } from '../auth/identity-sessions'

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
 * refresh key was spent by a renewal the device never saw, the pair parked for the device and
 * that key. A pair the device does not hold yet is to be delivered.
 */
export async function acceptKeys(
  sessions: Pick<IdentitySessions, 'authenticate' | 'parked'>,
  hello: {
    readonly device: string
    readonly access: string
    readonly refresh?: string | undefined
  },
): Promise<Result<Accepted, DataError>> {
  const { device, access, refresh } = hello
  const authenticated = await sessions.authenticate(
    refresh === undefined ? { access } : { access, refresh },
  )

  if (authenticated.isOk()) {
    const value = authenticated.value

    return ok({
      identity: value.identity,
      tokens: value.tokens,
      deliver: value.renewed ? value.tokens : undefined,
      spent: value.renewed ? refresh : undefined,
    })
  }

  const parked = refresh === undefined ? undefined : sessions.parked({ device, refresh })

  if (!parked) {
    return err(authenticated.error)
  }

  const resumed = await sessions.authenticate(parked)

  // The parked pair is new to the device, and so is a pair its access token had to be renewed to.
  return resumed.map(
    (value): Accepted => ({
      identity: value.identity,
      tokens: value.tokens,
      deliver: value.renewed ? value.tokens : parked,
      spent: value.renewed ? parked.refresh : undefined,
    }),
  )
}

/**
 * Binds the hello to its device's row: a renewal moves the row from the spent grant to the new
 * one (only while the row holds the spent grant and is not signed out), any other hello reads it.
 */
export function bindDevice(
  devices: Pick<DeviceSessions, 'bind' | 'rotate'>,
  input: { readonly identity: IdentityId; readonly device: string; readonly accepted: Accepted },
): ResultAsync<DeviceBinding, DataError> {
  const { identity, device, accepted } = input
  const { spent, deliver } = accepted

  if (spent === undefined || deliver === undefined) {
    return devices.bind({ identity, device })
  }

  const from = grantIdOf(spent)
  const to = grantIdOf(deliver.refresh)

  return from === undefined || to === undefined
    ? okAsync({ kind: 'other-grant' })
    : devices.rotate({ identity, device, spent: from, next: to })
}
