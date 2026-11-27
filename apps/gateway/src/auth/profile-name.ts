import { err, ok, type Result } from 'neverthrow'

import { CONTRACT_VALUES } from '@workspace/kernel'

/** Why a name breaks the rule of a profile's name: none left once trimmed, or too long. */
export type ProfileNameRefusal = 'name-required' | 'name-too-long'

/**
 * A name as a profile takes it: trimmed, 1 to the `profile.name` field's length in characters,
 * counted as the directory counts them (one for each code point). The name an account signs up with
 * becomes its profile's at its first sign-in, so a sign-up and an operator's rename are held to
 * this rule as the profile page is: the profile's schema would refuse a name that breaks it.
 */
export function profileNameOf(name: string): Result<string, ProfileNameRefusal> {
  const trimmed = name.trim()

  if (trimmed.length === 0) {
    return err('name-required')
  }

  return [...trimmed].length > CONTRACT_VALUES['profile.name'].maxLength
    ? err('name-too-long')
    : ok(trimmed)
}
