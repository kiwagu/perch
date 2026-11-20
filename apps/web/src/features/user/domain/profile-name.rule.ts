import type { Result } from 'neverthrow'

import { applyRules, CONTRACT_VALUES, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { textLength } from '../../../platform/text-length'

const nameRules: readonly DomainRule<string>[] = [
  { code: 'profile:NAME_REQUIRED', isSatisfiedBy: (name) => name.length > 0 },
  {
    code: 'profile:NAME_TOO_LONG',
    isSatisfiedBy: (name) => textLength(name) <= CONTRACT_VALUES['profile.name'].maxLength,
  },
]

/** A display name as the profile stores it: trimmed, present and not too long. */
export function checkProfileName(name: string): Result<string, readonly RuleViolation[]> {
  return applyRules(name.trim(), nameRules)
}
