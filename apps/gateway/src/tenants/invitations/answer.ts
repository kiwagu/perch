import { err, ok, type Result } from 'neverthrow'

import { type DataError, dataError, fromDriverValue } from '@workspace/data'
import { z } from '@workspace/zod'

/**
 * What the driver answers a query of one statement: an array holding that statement's result and
 * nothing else. A tuple, so that no answer (`[]`), a non-array or a second result is refused
 * before the result is looked at, even when the result's own schema accepts a missing value.
 */
const oneStatement = z.tuple([z.unknown()])

/**
 * The result of the one statement of a query, parsed with `schema`: an answer that is not that
 * statement's alone, or a result that `schema` refuses, is a `DataError` that names `what` and
 * keeps the values out. A missing row is `schema` accepting `undefined` or `null`, never an
 * answer that has no result.
 */
export function answered<T>(
  schema: z.ZodType<T>,
  answer: unknown,
  what: string,
): Result<T, DataError> {
  const envelope = oneStatement.safeParse(answer)
  const result = envelope.success ? schema.safeParse(fromDriverValue(envelope.data[0])) : undefined

  return result?.success
    ? ok(result.data)
    : err(dataError('data:QUERY_FAILED', `${what} has an unknown shape`))
}
