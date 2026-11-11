import { type DataError, dataError } from '@workspace/data'

/** The close code of a server that failed (RFC 6455): the device connects again. */
export const SERVER_ERROR = 1011

/** The close of a socket another connection of the device took over (RFC 6455, normal). */
export const SUPERSEDED = 1000

/** Close reasons and error messages are fixed texts: a reason never repeats what the device sent. */
export const REASON = {
  malformed: 'the message does not follow the protocol',
  helloFirst: 'the first message must be hello',
  helloTwice: 'hello was already said',
  silent: 'no hello in time',
  refused: 'the session was not accepted',
  noSession: 'no session for this device',
  forbidden: 'the region is not open to this device',
  signedOut: 'signed out',
  revoked: 'signed out from another device',
  passwordChanged: 'signed out because the password changed',
  deviceLimit: 'signed out by a sign-in past the limit of devices',
  banned: 'signed out because the account was banned',
  revokeFailed: 'revoke failed',
  failed: 'the gateway failed to handle the message',
  superseded: 'another connection of this device took over',
} as const

/** A failure to answer the device: reported, and its socket closes as a failed server. */
export function answerFailed(cause: unknown): DataError {
  return dataError('data:WRITE_FAILED', 'the sync connection failed to answer', cause)
}
