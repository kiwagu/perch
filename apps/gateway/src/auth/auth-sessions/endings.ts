import { err, ok, type Result } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { z } from '@workspace/zod'

import { type DeviceSessionRow, toDeviceSessionRow } from '../device-session-rows'

/**
 * What ending one session of an identity did: ended it now, found it ended already (both with its
 * row), or found no such session of the identity.
 */
export type SessionRevoke =
  | { readonly kind: 'ended'; readonly row: DeviceSessionRow }
  | { readonly kind: 'already-ended'; readonly row: DeviceSessionRow }
  | { readonly kind: 'missing' }

/**
 * What a sign-out by token did: ended a session that was live until now (`ended`), or found none
 * live to end (`not-live`: one that had expired, now marked ended at its expiry, one ended
 * already, or no session at all).
 */
export type SignOutEnding = 'ended' | 'not-live'

/** What the ending of one session answers when the identity has such a session. */
const revokeAnswer = z.object({ ended: z.boolean(), row: z.unknown() })

/** What a sign-out by token answers: whether the row it marked was live, for each row marked. */
const signOutAnswer = z.array(z.boolean())

/** What an ending of several sessions answers: the device of each session marked, and whether it was live. */
const endedSessions = z.array(z.object({ device: z.string(), live: z.boolean() }))

/**
 * What a sign-in's admission against the limit of devices did: let it in as it is (`admitted`),
 * deleted its session, not confirmed past the limit (`asked`), or let it in and signed out the
 * other device seen least recently (`signed-out`).
 */
export type SignInAdmission =
  | { readonly kind: 'admitted' }
  | { readonly kind: 'asked' }
  | { readonly kind: 'signed-out'; readonly device: string }

/** What the admission of a sign-in answers. */
const admissionAnswer = z.object({
  outcome: z.enum(['admitted', 'asked', 'signed-out']),
  device: z.string().optional(),
})

/** The admission of a sign-in as the directory answered it. */
export function toSignInAdmission(value: unknown): Result<SignInAdmission, DataError> {
  const answer = admissionAnswer.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the admission of a sign-in has an unknown shape'))
  }

  const { outcome, device } = answer.data

  if (outcome !== 'signed-out') {
    return ok({ kind: outcome })
  }

  return device === undefined
    ? err(dataError('data:QUERY_FAILED', 'the admission of a sign-in signed out no device'))
    : ok({ kind: 'signed-out', device })
}

/** The devices whose session an ending of several sessions ended while it was live, each once. */
export function toEndedDevices(value: unknown): Result<readonly string[], DataError> {
  const answer = endedSessions.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the ending of sessions has an unknown shape'))
  }

  return ok([...new Set(answer.data.filter(({ live }) => live).map(({ device }) => device))])
}

/** A sign-out as the directory answered it. */
export function toSignOutEnding(value: unknown): Result<SignOutEnding, DataError> {
  const answer = signOutAnswer.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the ending of a session has an unknown shape'))
  }

  return ok(answer.data.includes(true) ? 'ended' : 'not-live')
}

/** The ending of one session as the directory answered it; its row's values stay out of errors. */
export function toSessionRevoke(value: unknown): Result<SessionRevoke, DataError> {
  if (value === undefined || value === null) {
    return ok({ kind: 'missing' })
  }

  const answer = revokeAnswer.safeParse(value)

  if (!answer.success) {
    return err(dataError('data:QUERY_FAILED', 'the ending of a session has an unknown shape'))
  }

  const { ended } = answer.data

  return toDeviceSessionRow(answer.data.row).map(
    (row): SessionRevoke => (ended ? { kind: 'ended', row } : { kind: 'already-ended', row }),
  )
}
