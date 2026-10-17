/**
 * The profile of an account: what the user shows of themselves. It is keyed by a
 * profile id and belongs to exactly one identity.
 */

import type { Result } from 'neverthrow'

import { idSchemas } from '@workspace/ids'
import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'
import { z } from '@workspace/zod'

export const PROFILE_NAME_MAX = 80

/** The longest bio, in characters; the server's schema holds the same bound. */
export const PROFILE_BIO_MAX = 2000

export const ProfileSchema = z.object({
  id: idSchemas.profile.schema,
  identity: idSchemas.identity.schema,
  name: z.string().trim().min(1).max(PROFILE_NAME_MAX),
  email: z.email(),
  bio: z.string().max(PROFILE_BIO_MAX).optional(),
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

const bioRules: readonly DomainRule<string>[] = [
  { code: 'profile:BIO_TOO_LONG', isSatisfiedBy: (bio) => bio.length <= PROFILE_BIO_MAX },
]

/** A bio as the profile stores it: as written, empty or not too long. */
export function checkProfileBio(bio: string): Result<string, readonly RuleViolation[]> {
  return applyRules(bio, bioRules)
}
