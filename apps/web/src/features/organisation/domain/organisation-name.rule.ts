import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, type RuleViolation } from '@workspace/kernel'

import { ORGANISATION_NAME_MAX } from './organisation.entity'

const nameRules: readonly DomainRule<string>[] = [
  { code: 'organisation:NAME_REQUIRED', isSatisfiedBy: (name) => name.length > 0 },
  {
    code: 'organisation:NAME_TOO_LONG',
    isSatisfiedBy: (name) => name.length <= ORGANISATION_NAME_MAX,
  },
]

/** An organisation name as the gateway stores it: trimmed, present and not too long. */
export function checkOrganisationName(name: string): Result<string, readonly RuleViolation[]> {
  return applyRules(name.trim(), nameRules)
}
