import type { Result } from 'neverthrow'

import { applyRules, CONTRACT_VALUES, type DomainRule, type RuleViolation } from '@workspace/kernel'

const { minLength: MIN, maxLength: MAX } = CONTRACT_VALUES['second-factor-code']

const codeRules: readonly DomainRule<string>[] = [
  {
    code: 'sign-in:CODE_INVALID',
    isSatisfiedBy: (code) => code.length >= MIN && code.length <= MAX,
  },
]

/**
 * A code of the second factor as the gateway takes one: of the length the contract's
 * `second-factor-code` gives, whether an authenticator app's or a backup code. The code is kept as
 * typed, and what it is, right or wrong, is for the gateway to judge.
 */
export function checkSecondFactorCode(code: string): Result<string, readonly RuleViolation[]> {
  return applyRules(code, codeRules)
}
