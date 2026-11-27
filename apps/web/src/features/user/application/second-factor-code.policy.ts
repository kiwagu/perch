import type { Result } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'

import { checkSecondFactorCode } from '../domain/second-factor-code.rule'

/** The code as the domain accepts it, or the rule it breaks. */
export function secondFactorCode(code: string): Result<string, BusError> {
  return checkSecondFactorCode(code).mapErr((violations) => ({
    code: violations[0]?.code ?? 'sign-in:CODE_INVALID',
    causes: violations,
  }))
}
