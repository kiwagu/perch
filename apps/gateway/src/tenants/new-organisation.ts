import { err, ok, type Result } from 'neverthrow'

import { isTenantKey } from '@workspace/kernel'

/** The longest name an organisation may have, in characters. */
export const MAX_ORGANISATION_NAME = 80

/** What a creation asks, once it keeps the rules: the key as it is, the name trimmed. */
export interface NewOrganisation {
  readonly key: string
  readonly name: string
}

/** The rule a creation breaks: the key's pattern, or the name's presence or length. */
export type NewOrganisationRefusal = 'key-invalid' | 'name-required' | 'name-too-long'

/**
 * What a creation asks as an organisation takes it, or the first rule it breaks: a key that
 * follows the tenant key's pattern (`isTenantKey`), and a name of 1 to `MAX_ORGANISATION_NAME`
 * characters once trimmed (one for each code point). The route judges it before it counts the
 * attempt, and the service judges it again for any other caller.
 */
export function newOrganisationOf(input: {
  readonly key: string
  readonly name: string
}): Result<NewOrganisation, NewOrganisationRefusal> {
  const name = input.name.trim()
  const length = [...name].length

  if (!isTenantKey(input.key)) {
    return err('key-invalid')
  }

  if (length === 0) {
    return err('name-required')
  }

  return length > MAX_ORGANISATION_NAME ? err('name-too-long') : ok({ key: input.key, name })
}
