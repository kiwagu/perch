/**
 * A renewal a device asks for over its open channel: the pair the connection holds is renewed
 * with its refresh key, and the device's row moves from the grant the renewal spent to the new
 * one, as a hello's renewal does.
 */

import type { AuthTokens, AuthUser, DataError } from '@workspace/data'
import { CLOSE, type ServerMessage } from '@workspace/replica/protocol'

import type { DeviceSessions } from '../auth/device-sessions'
import {
  type DeviceTokens,
  type IdentitySessions,
  keysRefused,
  type RenewalGate,
} from '../auth/identity-sessions'

import { REASON } from './connection-reasons'
import { bindDevice } from './hello-keys'
import type { HelloRenewals } from './hello-renewals'

/**
 * What the connection does once a renewal over the channel ended: delivers the new pair; answers
 * the device and keeps the channel (no refresh key to renew with, or a renewal the limits refused,
 * nothing spent); closes as at hello (refused keys 4401, a device signed out from another one 4001,
 * a row that holds another grant or none 4401, the new pair revoked at once); or fails as a server
 * for a failure that judged nothing.
 */
export type ChannelRenewal =
  | { readonly kind: 'deliver'; readonly tokens: DeviceTokens }
  | { readonly kind: 'answer'; readonly message: ServerMessage }
  | { readonly kind: 'close'; readonly code: number; readonly reason: string }
  | { readonly kind: 'fail'; readonly error: DataError }

export interface ChannelRenewalDeps {
  readonly sessions: Pick<IdentitySessions, 'renew'>
  readonly devices: Pick<DeviceSessions, 'bind' | 'rotate'>
  /** Where a pair the device must not keep is dropped, its grant revoked. */
  readonly renewals: Pick<HelloRenewals, 'drop'>
}

/**
 * Renews the pair `tokens` of `device` once `renewal` lets it, and moves the device's row to the
 * new grant. A pair the row does not take (the device signed out, or its row holding another
 * grant or none) is dropped before the answer, so no grant lives that no device holds.
 */
export async function renewOnChannel(
  deps: ChannelRenewalDeps,
  input: {
    readonly identity: AuthUser
    readonly device: string
    readonly tokens: AuthTokens
    readonly renewal: RenewalGate
  },
): Promise<ChannelRenewal> {
  const { identity, device, tokens } = input

  if (tokens.refresh === undefined) {
    return {
      kind: 'answer',
      message: { type: 'error', code: 'unauthorized', message: REASON.noRefreshKey },
    }
  }

  const renewed = await deps.sessions.renew(
    { access: tokens.access, refresh: tokens.refresh },
    input.renewal,
  )

  if (renewed.isErr()) {
    const { error } = renewed

    if (error.code === 'data:RATE_LIMITED') {
      return {
        kind: 'answer',
        message: { type: 'error', code: 'rate-limited', message: REASON.tooManyRenewals },
      }
    }

    return keysRefused(error)
      ? { kind: 'close', code: CLOSE.unauthorized, reason: REASON.refused }
      : { kind: 'fail', error }
  }

  const next = renewed.value.tokens
  const binding = await bindDevice(deps.devices, {
    identity: identity.id,
    device,
    accepted: { identity, tokens: next, deliver: next, spent: tokens.refresh },
  })

  if (binding.isOk() && binding.value.kind === 'bound') {
    return { kind: 'deliver', tokens: next }
  }

  await deps.renewals.drop(identity.id, next)

  if (binding.isErr()) {
    return { kind: 'fail', error: binding.error }
  }

  return binding.value.kind === 'revoked'
    ? { kind: 'close', code: CLOSE.revoked, reason: REASON.revoked }
    : { kind: 'close', code: CLOSE.unauthorized, reason: REASON.noSession }
}
