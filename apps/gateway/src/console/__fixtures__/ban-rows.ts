/**
 * An account's ban and its session rows read straight from a directory for the console's specs:
 * what a ban or its lift left, the lapse of a ban the gateway never writes included, and each
 * session's ending as stored, by its device.
 */

import { fromDriverValue, type LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import banStateStatement from './ban-state.surql'
import sessionEndingsStatement from './session-endings.surql'

/** The ban of an account as the directory keeps it; what it lacks is absent. */
const banState = z.object({
  banned: z.boolean(),
  ban_reason: z.string().optional(),
  ban_expires: z.date().optional(),
})

export type BanState = z.infer<typeof banState>

/** A session row's ending as the directory keeps it; what it lacks is absent. */
const sessionEnding = z.object({
  device: z.string(),
  pending: z.boolean(),
  expires_at: z.date(),
  ended_at: z.date().optional(),
  ended_reason: z.string().optional(),
})

export type SessionEnding = Omit<z.infer<typeof sessionEnding>, 'device'>

/** The ban of the account of `identity`; the test fails when no account has it. */
export async function banOf(local: LocalDb, identity: IdentityId): Promise<BanState> {
  const [row] = await local.db.query<[unknown]>(banStateStatement, { identity })

  return banState.parse(fromDriverValue(row))
}

/** How each session row of `identity` ends or ended, by its device. */
export async function sessionEndingsOf(
  local: LocalDb,
  identity: string,
): Promise<Record<string, SessionEnding>> {
  const [rows] = await local.db.query<[unknown[]]>(sessionEndingsStatement, { identity })

  return Object.fromEntries(
    z
      .array(sessionEnding)
      .parse(fromDriverValue(rows))
      .map(({ device, ...ending }) => [device, ending]),
  )
}
