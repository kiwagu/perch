import { err, ok, type Result } from 'neverthrow'

/** The longest name a profile takes, in characters, as the directory's schema holds it. */
export const MAX_PROFILE_NAME = 80

/** Why a name breaks the rule of a profile's name: none left once trimmed, or too long. */
export type ProfileNameRefusal = 'name-required' | 'name-too-long'

/**
 * A name as a profile takes it: trimmed, 1 to `MAX_PROFILE_NAME` characters, counted as the
 * directory counts them (one for each code point). The name an account signs up with becomes its
 * profile's at its first sign-in, so a sign-up and an operator's rename are held to this rule as
 * the profile page is: the profile's schema would refuse a name that breaks it.
 */
export function profileNameOf(name: string): Result<string, ProfileNameRefusal> {
  const trimmed = name.trim()

  if (trimmed.length === 0) {
    return err('name-required')
  }

  return [...trimmed].length > MAX_PROFILE_NAME ? err('name-too-long') : ok(trimmed)
}
