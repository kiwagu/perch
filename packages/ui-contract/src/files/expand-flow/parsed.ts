/** A region written in a shorter form, parsed by that form's own strict schema. */

import type { z } from '@workspace/zod'

import { englishErrors } from '../parse-file'

import type { Expansion } from './expansion'

/** `region` parsed by `schema`, or undefined with its issues reported at their place. */
export function parsed<S extends z.ZodType>(
  schema: S,
  region: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): z.output<S> | undefined {
  const result = schema.safeParse(region, { error: englishErrors })

  if (result.success) {
    return result.data
  }

  for (const issue of result.error.issues) {
    expansion.issues.push({ at: [...at, ...issue.path], message: issue.message })
  }

  return undefined
}
