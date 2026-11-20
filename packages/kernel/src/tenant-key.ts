/**
 * How an organisation is keyed across runtimes. A key is checked wherever it comes in; the
 * directory's schema holds the same rule.
 */

import { CONTRACT_VALUES } from './contract-values.gen'

/** What a key is: the pattern of the contract's `organisation-key`. */
export const TENANT_KEY_PATTERN = new RegExp(CONTRACT_VALUES['organisation-key'].pattern)

export function isTenantKey(value: string): boolean {
  return TENANT_KEY_PATTERN.test(value)
}
