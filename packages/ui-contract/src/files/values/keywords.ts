/** The keywords of a value as the engine writes them: each one it has, in the order a value lists them. */

import type { z } from '@workspace/zod'

import type { resolvedValueSchema } from '../../schemas'

type Resolved = z.infer<typeof resolvedValueSchema>

/**
 * A value as the engine resolves it: its type and its constraints, nothing else, read-only, its
 * enum a readonly list, so a caller may pass a value it holds read-only.
 */
export type ResolvedValue = {
  readonly [K in keyof Resolved]: Resolved[K] extends infer V
    ? V extends readonly (infer M)[]
      ? readonly M[]
      : V
    : never
}

/** The keywords `value` writes, in the order a value lists them, and nothing else. */
export function keywordsOf(value: ResolvedValue): ResolvedValue {
  const { type, enum: values, minLength, maxLength, pattern, format, minimum, maximum } = value

  return {
    ...(type === undefined ? {} : { type }),
    ...(values === undefined ? {} : { enum: values }),
    ...(minLength === undefined ? {} : { minLength }),
    ...(maxLength === undefined ? {} : { maxLength }),
    ...(pattern === undefined ? {} : { pattern }),
    ...(format === undefined ? {} : { format }),
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(value.readOnly === undefined ? {} : { readOnly: value.readOnly }),
  }
}
