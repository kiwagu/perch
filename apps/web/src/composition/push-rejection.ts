import type { DataError } from '@workspace/data'
import { z } from '@workspace/zod'

import type { PushRejection } from '../platform/session.port'

/** What a refused push carries as its cause, read as the port's `PushRejection`. */
const pushRejection = z.object({
  region: z.string(),
  batch: z.number(),
  reason: z.string(),
  detail: z.string(),
}) satisfies z.ZodType<PushRejection>

/** The change the gateway refused, when `error` is a refused push that says which. */
export function rejectionOf(error: DataError): PushRejection | undefined {
  if (error.code !== 'data:PUSH_REJECTED') {
    return undefined
  }

  const rejection = pushRejection.safeParse(error.cause)

  return rejection.success ? rejection.data : undefined
}
