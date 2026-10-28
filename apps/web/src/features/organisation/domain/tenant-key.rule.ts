import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, isTenantKey, type RuleViolation } from '@workspace/kernel'

const keyRules: readonly DomainRule<string>[] = [
  { code: 'organisation:KEY_INVALID', isSatisfiedBy: isTenantKey },
]

/** An organisation key as the gateway accepts it: trimmed and of the tenant key's rule. */
export function checkTenantKey(key: string): Result<string, readonly RuleViolation[]> {
  return applyRules(key.trim(), keyRules)
}
