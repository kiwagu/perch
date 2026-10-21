import { err, ok, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, fromDriverValue } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

/** A member of an organisation as its members see it: the identity, its email and its role. */
export interface Member {
  readonly identity: { readonly id: IdentityId; readonly email: string }
  readonly role: TenantRole
}

/** An organisation as the directory holds it. */
export interface Tenant {
  readonly id: string
  readonly key: string
  readonly name: string
}

/** The directory's row of an organisation; record ids come as the driver's own values. */
export interface TenantRow {
  readonly id: unknown
  readonly key: string
  readonly name: string
  readonly database: string
  readonly status: 'provisioning' | 'ready'
  readonly created_by: unknown
}

/** A membership with its organisation's id, key and name, as `memberships-of` reads it. */
export interface MembershipRow {
  readonly role: TenantRole
  readonly id: unknown
  readonly key: string
  readonly name: string
}

export interface IdentityRow {
  readonly id: unknown
  readonly email: string
}

/** A row of an organisation's member table, keyed by the identity's key. */
export interface MemberRow {
  readonly id: unknown
  readonly role: TenantRole
}

/** The key of a record id as the driver returns it. */
export function keyOf(id: unknown): string {
  return String(fromDriverValue(id))
}

/**
 * Whether the database refused a write because the unique index `index` already holds its value.
 * The driver names no code for it (an `InternalError` of kind `Internal`, code 0), so its text is
 * read: the same from the embedded engine and from the 3.3.4 server, pinned by the spec.
 */
export function takenIn(index: string, error: DataError): boolean {
  const message = error.cause instanceof Error ? error.cause.message : String(error.cause)

  return message.startsWith(`Database index \`${index}\` already contains `)
}

/** A read of the database, as a result. */
export function reading<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:QUERY_FAILED', message, cause))
}

/**
 * A write to the database, as a result. Every write here is sent with the driver's `retry()`:
 * the database may refuse one as a conflict with a concurrent transaction, and each of them may
 * be replayed.
 */
export function writing<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:WRITE_FAILED', message, cause))
}

export function identityIdOf(key: string): Result<IdentityId, DataError> {
  return identityIdFactory.is(key)
    ? ok(key)
    : err(dataError('data:QUERY_FAILED', `${key} is not an identity id`))
}

export function toTenant(row: TenantRow): Tenant {
  return { id: keyOf(row.id), key: row.key, name: row.name }
}

export function toMembership(row: MembershipRow): Membership {
  return { tenant: { id: keyOf(row.id), key: row.key, name: row.name }, role: row.role }
}
