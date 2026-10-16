/**
 * The one Zod instance of the workspace. Every package imports Zod from here so
 * that the error map below applies everywhere: an issue without an explicit
 * message carries a translation key (`validation.<issue code>`) instead of
 * English prose, and the presentation layer turns the key into text.
 */

import { z } from 'zod'

export const validationKey = (code: string): string => `validation.${code}`

z.config({
  customError: (issue) => validationKey(issue.code),
})

export { z }
