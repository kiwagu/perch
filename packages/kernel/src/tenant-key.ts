/**
 * How an organisation is keyed across runtimes. A key is checked wherever it comes in; the
 * directory's schema holds the same rule.
 */

import { CONTRACT_VALUES } from './contract-values.gen'

const { maxLength, pattern } = CONTRACT_VALUES['organisation-key']

/**
 * What a key is: of the pattern of the contract's `organisation-key` and no longer than its
 * `maxLength`, whatever length the pattern itself allows. A key in a path is read with it too.
 */
export const TENANT_KEY_PATTERN = new RegExp(`^(?=[\\s\\S]{0,${maxLength}}$)(?:${pattern})`)

export function isTenantKey(value: string): boolean {
  return TENANT_KEY_PATTERN.test(value)
}
