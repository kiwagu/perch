/**
 * An account's ban written straight into the directory, as an operator's ban leaves it, and the
 * session rows of an account read straight from it: the specs of the ban's boundary read here
 * whether a row waits (`pending`, which the gateway's own row parser does not carry) and its
 * `ended_reason` as stored.
 */

import { fromDriverValue, type LocalDb } from '@workspace/data'
import { z } from '@workspace/zod'

import sessionStatesStatement from './device-session-states.surql'
import identityBanStatement from './identity-ban.surql'
import identityBannedSetStatement from './identity-banned-set.surql'

/** A session row of an account as the directory keeps it. */
const stateRow = z.object({
  device: z.string(),
  token: z.string(),
  pending: z.boolean(),
  ended_at: z.date().optional(),
  ended_reason: z.string().optional(),
})

export type SessionState = z.infer<typeof stateRow>

/**
 * Bans `identity` in one transaction, as an operator's ban does: the flag set, and every session
 * not ended already, a waiting one included, ended at `at` with `banned` as its reason.
 */
export async function ban(local: LocalDb, identity: string, at: Date): Promise<void> {
  await local.db.query(identityBanStatement, { identity, ended_at: at })
}

/**
 * Sets the ban flag of `identity` alone, ending none of its sessions: what a ban that committed
 * before a session was written leaves for that session.
 */
export async function setBanned(local: LocalDb, identity: string, banned: boolean): Promise<void> {
  await local.db.query(identityBannedSetStatement, { identity, banned })
}

/** Every session row of `identity`, the earliest first. */
export async function sessionStates(local: LocalDb, identity: string): Promise<SessionState[]> {
  const [rows] = await local.db.query<[unknown[]]>(sessionStatesStatement, { identity })

  return z.array(stateRow).parse(fromDriverValue(rows))
}

/** The session row holding `token` of `identity`; the test fails when there is none. */
export async function sessionState(
  local: LocalDb,
  identity: string,
  token: string,
): Promise<SessionState> {
  const row = (await sessionStates(local, identity)).find((each) => each.token === token)

  if (row === undefined) {
    throw new Error('no session row holds the token')
  }

  return row
}
