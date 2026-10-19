import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { PROFILE_BIO_MAX } from './profile.entity'

const bioRules: readonly DomainRule<string>[] = [
  { code: 'profile:BIO_TOO_LONG', isSatisfiedBy: (bio) => bio.length <= PROFILE_BIO_MAX },
]

/** A bio as the profile stores it: as written, empty or not too long. */
export function checkProfileBio(bio: string): Result<string, readonly RuleViolation[]> {
  return applyRules(bio, bioRules)
}
