import type { Result } from 'neverthrow'

import { applyRules, CONTRACT_VALUES, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { textLength } from '../../../platform/text-length'

const bioRules: readonly DomainRule<string>[] = [
  {
    code: 'profile:BIO_TOO_LONG',
    isSatisfiedBy: (bio) => textLength(bio) <= CONTRACT_VALUES['profile.bio'].maxLength,
  },
]

/** A bio as the profile stores it: as written, empty or not too long. */
export function checkProfileBio(bio: string): Result<string, readonly RuleViolation[]> {
  return applyRules(bio, bioRules)
}
