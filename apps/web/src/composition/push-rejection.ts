import type { DataError } from '@workspace/data'
import { z } from '@workspace/zod'

import type { PushRejection } from '../platform/session.port'

/** What a refused push, or the reload of a region whose refused push was refused again, carries as its cause. */
const refusal = z.object({
  region: z.string(),
  batch: z.number(),
  reason: z.string(),
  detail: z.string(),
})

/**
 * The change the gateway refused, when `error` is a refused push that says which, or the reload of
 * a region whose undo the gateway refused too.
 */
export function rejectionOf(error: DataError): PushRejection | undefined {
  if (error.code !== 'data:PUSH_REJECTED' && error.code !== 'data:REGION_RELOADED') {
    return undefined
  }

  const parsed = refusal.safeParse(error.cause)

  return parsed.success
    ? { ...parsed.data, reloaded: error.code === 'data:REGION_RELOADED' }
    : undefined
}
