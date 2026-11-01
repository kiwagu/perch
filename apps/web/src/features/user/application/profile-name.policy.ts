import type { Result } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'

import { checkProfileName } from '../domain/profile-name.rule'

/** The display name as the domain accepts it, or the rule it breaks. */
export function profileName(name: string): Result<string, BusError> {
  return checkProfileName(name).mapErr((violations) => ({
    code: violations[0]?.code ?? 'profile:INVALID_NAME',
    causes: violations,
  }))
}
