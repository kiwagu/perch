import { err, ok, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { z } from '@workspace/zod'

import { writing } from '../../src/auth/device-session-rows'

import identityRoleSetStatement from './surql/identity-role-set.surql'

/** The platform role an account is given: `operator`, or `user`, the plugin's default one. */
export type PlatformRoleSetting = 'operator' | 'user'

/** What the directory answers to the write: the key of every identity it changed. */
const changedKeys = z.array(z.string())

/**
 * Writes `role` on the account whose email is `email`, in any case, and on nothing else of it: no
 * session ends and no socket closes, as the gateway's memory is out of a host command's reach, so
 * its devices learn the role at their next hello. `set` once the account has it (an account that
 * held it already included), `no-account` when no account has the email. A failure names neither
 * the email nor the row.
 */
export function setPlatformRole(
  directory: LocalDb,
  email: string,
  role: PlatformRoleSetting,
): ResultAsync<'set' | 'no-account', DataError> {
  return writing(
    directory.db.query<[unknown]>(identityRoleSetStatement, { email, role }).retry(),
    'the role of an account could not be written',
  ).andThen(([changed]) => {
    const keys = changedKeys.safeParse(changed)

    if (!keys.success) {
      return err(dataError('data:QUERY_FAILED', 'the directory answered a role write unreadably'))
    }

    const answer: 'set' | 'no-account' = keys.data.length > 0 ? 'set' : 'no-account'

    return ok(answer)
  })
}
