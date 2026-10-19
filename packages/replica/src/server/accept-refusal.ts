import { type DataError, dataError } from '@workspace/data'

import { messageOf } from '../failure'

/**
 * How SurrealDB words a write that breaks a schema rule: a field's type, a field's ASSERT,
 * a UNIQUE index, a READONLY field, or a field a SCHEMAFULL table does not define.
 */
const SCHEMA_VIOLATIONS: readonly RegExp[] = [
  /^Couldn't coerce value for field `/,
  /, but field must conform to: /,
  /^Database index `[^`]+` already contains /,
  /^Found changed value for field `[^`]+`, with record `.+`, but field is readonly$/,
  /^Found field '[^']+', but no such field exists for table /,
]

/**
 * What the accept transaction throws for a record of another region, `ownership:<entry>`, as
 * SurrealDB reports a THROW: `An error occurred: <text>`. Anchored, so a record key that looks
 * like it, inside another error's message, is not taken for a refusal.
 */
const OWNERSHIP_REFUSAL = /^An error occurred: ownership:(.+)$/

function breaksSchemaRule(cause: unknown): boolean {
  const message = messageOf(cause)

  return SCHEMA_VIOLATIONS.some((pattern) => pattern.test(message))
}

/** The error a failed accept transaction of `region` stands for: a record of another region, a schema rule, or a failure. */
export function acceptRefusal(region: string, cause: unknown): DataError {
  const foreign = OWNERSHIP_REFUSAL.exec(messageOf(cause))?.[1]

  if (foreign) {
    return dataError(
      'data:WRITE_REJECTED',
      `ownership: ${foreign} is not a record of ${region}`,
      cause,
    )
  }

  return breaksSchemaRule(cause)
    ? dataError('data:WRITE_REJECTED', `a batch of ${region} breaks a schema rule`, cause)
    : dataError('data:WRITE_FAILED', `could not accept a batch of ${region}`, cause)
}
