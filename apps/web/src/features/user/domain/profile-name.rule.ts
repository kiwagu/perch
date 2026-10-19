import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { PROFILE_NAME_MAX } from './profile.entity'

const nameRules: readonly DomainRule<string>[] = [
  { code: 'profile:NAME_REQUIRED', isSatisfiedBy: (name) => name.length > 0 },
  { code: 'profile:NAME_TOO_LONG', isSatisfiedBy: (name) => name.length <= PROFILE_NAME_MAX },
]

/** A display name as the profile stores it: trimmed, present and not too long. */
export function checkProfileName(name: string): Result<string, readonly RuleViolation[]> {
  return applyRules(name.trim(), nameRules)
}
