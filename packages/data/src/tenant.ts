/**
 * Where an organisation's data lives: the database that holds it and the region document its
 * members share, both named after the organisation's key (`isTenantKey` in the kernel).
 */

/** The organisation's database in the application namespace. */
export function tenantDatabase(key: string): string {
  return `t_${key}`
}

/** The region document every member of the organisation shares. */
export function tenantRegionId(key: string): string {
  return `tenant:${key}`
}
