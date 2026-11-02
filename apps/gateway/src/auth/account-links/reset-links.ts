import { err, ok, type Result, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue, type LocalDb } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { z } from '@workspace/zod'

import { reading, writing } from '../device-session-rows'
import resetLinkStatement from '../surql/reset-link.surql'
import resetLinksKeepNewestStatement from '../surql/reset-links-keep-newest.surql'

/** A reset link as its token finds it: the identity it resets the password of, and its expiry. */
export interface ResetLink {
  readonly identity: IdentityId
  readonly expiresAt: Date
}

const resetLinkRow = z.object({ identity: idSchemas.identity.schema, expires_at: z.date() })

/** A link's row as the directory answered it, or none; its values stay out of the error. */
function toResetLink(value: unknown): Result<ResetLink | undefined, DataError> {
  if (value === undefined || value === null) {
    return ok(undefined)
  }

  const row = resetLinkRow.safeParse(fromDriverValue(value))

  return row.success
    ? ok({ identity: row.data.identity, expiresAt: row.data.expires_at })
    : err(dataError('data:QUERY_FAILED', 'a reset link has an unknown shape'))
}

/**
 * The reset links of accounts, which Better Auth keeps in `verification` (an identifier
 * `reset-password:<token>`, the identity's key as its value, an expiry an hour after the request):
 * read by a token, or ended for an identity but the newest. A link is spent, and the account's
 * others ended, by the reset's own transaction (`AccountPasswords.reset`). Better Auth's own
 * clean-up of expired rows is off in the instance, so a link past its expiry still reads as one
 * that expired, not as one nobody had; an identity keeps one link at most, as each request
 * replaces the earlier ones and a reset or a change of the password ends them all. Nothing here
 * logs, and no error names a token.
 */
export class ResetLinks {
  readonly #directory: LocalDb

  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /** The link whose token is `token`, or none: a token no link holds, or one used or replaced. */
  read(token: string): ResultAsync<ResetLink | undefined, DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(resetLinkStatement, { link_token: token }),
      'a reset link could not be read',
    ).andThen(([value]) => toResetLink(value))
  }

  /** Ends every reset link of `identity` but the newest, whose token is `token`. */
  keepNewest(identity: IdentityId, token: string): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(resetLinksKeepNewestStatement, { identity, link_token: token })
        .retry(),
      `the earlier reset links of ${identity} could not be ended`,
    ).map(() => undefined)
  }
}
