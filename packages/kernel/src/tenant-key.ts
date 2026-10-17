/**
 * How an organisation is keyed across runtimes. A key is checked wherever it comes in; the
 * directory's schema holds the same rule.
 */

/** 2 to 32 lowercase letters, digits and underscores, starting with a letter. */
export const TENANT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/

export function isTenantKey(value: string): boolean {
  return TENANT_KEY_PATTERN.test(value)
}
