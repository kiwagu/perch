import type { BetterAuthOptions, DBAdapter } from 'better-auth'
import { APIError, isAPIError } from 'better-auth/api'

import type { AuthLog } from './auth-log'

/**
 * The code Better Auth answers with when the directory did not take one of the writes
 * `storageFailuresTold` tells apart: a failure of the service, never a refusal of what the device
 * sent.
 */
export const STORAGE_FAILED = 'STORAGE_FAILED'

/** The models whose rows' creation is told apart: a passkey kept, and a session written. */
const TOLD_CREATES: ReadonlySet<string> = new Set(['passkey', 'session'])

/** The models whose rows' update is told apart: a passkey's count of signatures moved on. */
const TOLD_UPDATES: ReadonlySet<string> = new Set(['passkey'])

/**
 * A failure of a write as Better Auth's own error, which its plugins pass on as it is, logged by its
 * code alone: Better Auth answers its own errors without handing them to its error hook, so this is
 * where the failure is told.
 */
function told(cause: unknown, log: AuthLog): unknown {
  if (isAPIError(cause)) {
    return cause
  }

  log.error({ code: `auth:${STORAGE_FAILED}` }, 'the directory did not take a write')

  return new APIError('INTERNAL_SERVER_ERROR', {
    code: STORAGE_FAILED,
    message: 'the directory did not take a write',
  })
}

/** What Better Auth asks its adapter to create: a row of `model` holding `data`. */
interface Created<T> {
  readonly model: string
  readonly data: Omit<T, 'id'>
  readonly select?: string[] | undefined
  readonly forceAllowId?: boolean | undefined
}

/** `write`'s answer, its failure told apart (and logged on `log`) when `tell` holds. */
async function writing<R>(tell: boolean, log: AuthLog, write: () => Promise<R>): Promise<R> {
  try {
    return await write()
  } catch (cause) {
    throw tell ? told(cause, log) : cause
  }
}

/**
 * Better Auth's adapter made by `factory`, a failed write of a passkey (kept, or its count of
 * signatures moved on) or of a session thrown as Better Auth's own error (500, `STORAGE_FAILED`),
 * nothing of its cause kept, and logged on `log` as `auth:STORAGE_FAILED`. The passkey plugin turns any other failure inside a ceremony into a
 * refusal of what the device sent (`FAILED_TO_VERIFY_REGISTRATION`, `AUTHENTICATION_FAILED`), a
 * malformed answer and a database that failed alike, while it passes Better Auth's own errors on:
 * so a ceremony the directory could not keep answers as a failure of the service. Every other read
 * and write is the adapter's as it is.
 */
export function storageFailuresTold(
  factory: (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions>,
  log: AuthLog,
): (options: BetterAuthOptions) => DBAdapter<BetterAuthOptions> {
  return (options) => {
    const adapter = factory(options)

    return {
      ...adapter,
      create: <T extends Record<string, unknown>, R = T>(data: Created<T>) =>
        writing(TOLD_CREATES.has(data.model), log, () => adapter.create<T, R>(data)),
      update: <T>(data: Parameters<typeof adapter.update>[0]) =>
        writing(TOLD_UPDATES.has(data.model), log, () => adapter.update<T>(data)),
    }
  }
}
