/** Zod issues as problems of a contract file, each named by its JSON path, in English. */

import { z } from '@workspace/zod'

import { jsonPath, type Problem } from './problems'

/** English messages for Zod issues: the workspace error map yields translation keys. */
export const englishErrors = z.locales.en().localeError

/** Parses `data` with English messages; `at` is where `data` sits in the file. */
export function parseFile<T extends z.ZodType>(
  file: string,
  schema: T,
  data: unknown,
  at: readonly PropertyKey[] = [],
): { value?: z.output<T>; problems: Problem[] } {
  const parsed = schema.safeParse(data, { error: englishErrors })

  if (parsed.success) {
    return { value: parsed.data, problems: [] }
  }

  return {
    problems: parsed.error.issues.map((issue) => ({
      file,
      message: `${jsonPath([...at, ...issue.path])}: ${issue.message}`,
    })),
  }
}
