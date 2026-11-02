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
