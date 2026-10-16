import { err, ok, type Result } from 'neverthrow'

export interface DomainRule<T> {
  readonly code: string
  readonly isSatisfiedBy: (value: T) => boolean
}

export interface RuleViolation {
  readonly code: string
}

/** Checks every rule and reports all violations at once, not only the first. */
export function applyRules<T>(
  value: T,
  rules: readonly DomainRule<T>[],
): Result<T, readonly RuleViolation[]> {
  const violations = rules
    .filter((rule) => !rule.isSatisfiedBy(value))
    .map((rule) => ({ code: rule.code }))

  return violations.length === 0 ? ok(value) : err(violations)
}
