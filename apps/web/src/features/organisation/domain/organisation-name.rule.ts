import type { Result } from 'neverthrow'

import { applyRules, CONTRACT_VALUES, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { textLength } from '../../../platform/text-length'

const nameRules: readonly DomainRule<string>[] = [
  { code: 'organisation:NAME_REQUIRED', isSatisfiedBy: (name) => name.length > 0 },
  {
    code: 'organisation:NAME_TOO_LONG',
    isSatisfiedBy: (name) => textLength(name) <= CONTRACT_VALUES['organisation-name'].maxLength,
  },
]

/** An organisation name as the gateway stores it: trimmed, present and not too long. */
export function checkOrganisationName(name: string): Result<string, readonly RuleViolation[]> {
  return applyRules(name.trim(), nameRules)
}
