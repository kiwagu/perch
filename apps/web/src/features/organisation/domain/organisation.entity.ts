/**
 * An organisation: a group of identities that share a tenant region. It is known by a key,
 * which names its database and region, and shows a name; the identity that creates one is
 * its administrator.
 */

import type { Result } from 'neverthrow'

import { applyRules, type DomainRule, isTenantKey, type RuleViolation } from '@workspace/kernel'

/** The longest organisation name, in characters; the gateway holds the same bound. */
export const ORGANISATION_NAME_MAX = 80

const keyRules: readonly DomainRule<string>[] = [
  { code: 'organisation:KEY_INVALID', isSatisfiedBy: isTenantKey },
]

/** An organisation key as the gateway accepts it: trimmed and of the tenant key's rule. */
export function checkTenantKey(key: string): Result<string, readonly RuleViolation[]> {
  return applyRules(key.trim(), keyRules)
}

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
