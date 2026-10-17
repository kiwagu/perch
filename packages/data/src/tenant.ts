/**
 * How an organisation is named across runtimes: its key, the database that holds its data
 * and the region document its members share. A key is checked wherever it comes in; the
 * directory's schema holds the same rule.
 */

export const TENANT_KEY_PATTERN = /^[a-z][a-z0-9_]{1,31}$/

export function isTenantKey(value: string): boolean {
  return TENANT_KEY_PATTERN.test(value)
}

/** The organisation's database in the application namespace. */
export function tenantDatabase(key: string): string {
  return `t_${key}`
}

/** The region document every member of the organisation shares. */
export function tenantRegionId(key: string): string {
  return `tenant:${key}`
}
