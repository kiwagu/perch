import { CLOSE } from '../../protocol'

import type { EndReason } from './port'

/**
 * Close codes after which the gateway will not take the device back, and what they mean. Any
 * other close, a hello the gateway stopped waiting for (4408) included, is followed by a reconnect.
 */
const ENDINGS: ReadonlyMap<number, EndReason> = new Map([
  [CLOSE.unauthorized, 'unauthorized'],
  [CLOSE.protocol, 'protocol'],
  [CLOSE.signedOut, 'signed-out'],
  [CLOSE.revoked, 'revoked'],
  [CLOSE.passwordChanged, 'password-changed'],
  [CLOSE.deviceLimit, 'device-limit'],
  [CLOSE.banned, 'banned'],
])

/** Why a close with `code` ends the channel for good; `undefined` for a close a reconnect follows. */
export function endingOf(code: number): EndReason | undefined {
  return ENDINGS.get(code)
}
