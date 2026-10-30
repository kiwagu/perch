import type { Result } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'

import { checkProfileBio } from '../domain/profile-bio.rule'

/** A bio as the domain accepts it, or the rule it breaks. */
export function profileBio(bio: string): Result<string, BusError> {
  return checkProfileBio(bio).mapErr((violations) => ({
    code: violations[0]?.code ?? 'profile:INVALID_BIO',
    causes: violations,
  }))
}
