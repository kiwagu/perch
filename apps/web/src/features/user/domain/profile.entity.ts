/**
 * The profile of an account: what the user shows of themselves. It is keyed by a
 * profile id and belongs to exactly one identity.
 */

import type { Result } from 'neverthrow'

import { idSchemas } from '@workspace/ids'
import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'
import { z } from '@workspace/zod'

export const PROFILE_NAME_MAX = 80

export const ProfileSchema = z.object({
  id: idSchemas.profile.schema,
  identity: idSchemas.identity.schema,
  name: z.string().trim().min(1).max(PROFILE_NAME_MAX),
  email: z.email(),
  bio: z.string().optional(),
  locale: z.enum(['en', 'es']).optional(),
  createdAt: z.date(),
})

export type Profile = z.infer<typeof ProfileSchema>

const nameRules: readonly DomainRule<string>[] = [
  { code: 'profile:NAME_REQUIRED', isSatisfiedBy: (name) => name.length > 0 },
  { code: 'profile:NAME_TOO_LONG', isSatisfiedBy: (name) => name.length <= PROFILE_NAME_MAX },
]

/** A display name as the profile stores it: trimmed, present and not too long. */
export function checkProfileName(name: string): Result<string, readonly RuleViolation[]> {
  return applyRules(name.trim(), nameRules)
}
