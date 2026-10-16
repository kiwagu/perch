import { errAsync } from 'neverthrow'

import type { z } from '@workspace/zod'

import type { Middleware } from './bus'

/**
 * Parses each payload with the schema registered for its message type and hands
 * the parsed value on. Local calls never cross a transport boundary, so the bus
 * itself is where untrusted input gets checked.
 */
export function validatePayloads(
  schemas: Readonly<Record<string, z.ZodType | undefined>>,
): Middleware {
  return (message, _context, next) => {
    const schema = schemas[message.type]

    if (!schema) {
      return next(message)
    }

    const parsed = schema.safeParse(message.payload)

    if (!parsed.success) {
      return errAsync({ code: 'bus:INVALID_PAYLOAD', issues: parsed.error.issues })
    }

    return next({ ...message, payload: parsed.data })
  }
}
