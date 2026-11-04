import { err, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  fromDriverValue,
  type LocalDb,
  recordId,
  tenantDatabase,
} from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import { tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { reading, writing } from './organisation-rows'
import departingMembershipsStatement from './surql/departing-memberships.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import tenantRemoveStatement from './surql/tenant-remove.surql'
import type { TenantDatabases } from './tenant-databases'
import { TenantMembers } from './tenant-members'

/**
 * A membership of the departing identity, as `departing-memberships.surql` answers it once its
 * values are plain. The database is the one its key names: the departure removes it, so a row
 * naming any other database is refused rather than followed.
 */
const departingMembership = z
  .object({
    tenant: idSchemas.tenant.schema,
    key: z.string().refine(isTenantKey),
    database: z.string(),
    status: z.enum(['provisioning', 'ready']),
    role: tenantRole,
    members: z.number().int().positive(),
    admins: z.number().int().nonnegative(),
  })
  .refine((row) => row.database === tenantDatabase(row.key))

type DepartingMembership = z.output<typeof departingMembership>

const departingMemberships = z.array(departingMembership)

export interface AccountDepartureOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire' | 'evict'>
}

/**
 * The organisations of an identity whose account goes. Who is the only member or the last admin
 * of an organisation is the directory's word: its memberships and their roles. An organisation
 * the identity is the only member of goes whole, of any status, one still provisioning too; in
 * any other the identity's membership goes, then its member row leaves the organisation's
 * database, and its notes stay. Its connections are the caller's to close beforehand, and the
 * other members are told nothing: they read the members when they ask for them.
 */
export class AccountDeparture {
  readonly #directory: LocalDb
  readonly #members: TenantMembers
  readonly #databases: Pick<TenantDatabases, 'evict'>

  constructor(options: AccountDepartureOptions) {
    this.#directory = options.directory
    this.#members = new TenantMembers(options.databases)
    this.#databases = options.databases
  }

  /**
   * True when the identity is the only admin of a ready organisation that has other members: its
   * departure would leave them without an admin.
   */
  blocked(identity: IdentityId): ResultAsync<boolean, DataError> {
    return this.#departing(identity).map((rows) =>
      rows.some(
        (row) =>
          row.status === 'ready' && row.role === 'admin' && row.admins === 1 && row.members > 1,
      ),
    )
  }

  /**
   * Every membership of the identity goes, one organisation after the other, the first failure
   * answering. An organisation it is the only member of goes whole: its database, its
   * memberships and its directory row in one transaction, then the cached connection to it. A
   * run again after a failure completes what the directory still holds. A member row whose
   * removal failed once its membership was gone is not found again: it stays behind like the row
   * of an identity that is gone, which the members list leaves out. A run after a success finds
   * nothing and changes nothing.
   */
  leave(identity: IdentityId): ResultAsync<void, DataError> {
    return this.#departing(identity).andThen((rows) =>
      rows.reduce(
        (done, row) =>
          done.andThen(() =>
            row.members === 1 ? this.#removeTenant(row) : this.#leaveTenant(identity, row),
          ),
        okAsync<void, DataError>(undefined),
      ),
    )
  }

  /** The memberships of the identity in organisations of any status, parsed. */
  #departing(identity: IdentityId): ResultAsync<readonly DepartingMembership[], DataError> {
    return reading(
      this.#directory.db.query<[unknown]>(departingMembershipsStatement, {
        identity: recordId('identity', identity),
      }),
      `could not read the memberships of ${identity}`,
    ).andThen(([value]): Result<readonly DepartingMembership[], DataError> => {
      const rows = departingMemberships.safeParse(fromDriverValue(value))

      return rows.success
        ? ok(rows.data)
        : err(
            dataError(
              'data:QUERY_FAILED',
              `the memberships of ${identity} to leave have an unknown shape`,
            ),
          )
    })
  }

  /** The organisation goes whole, and so does the cached connection to its database. */
  #removeTenant(row: DepartingMembership): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(tenantRemoveStatement, {
          tenant: recordId('tenant', row.tenant),
          database: row.database,
        })
        .retry(),
      `could not remove organisation ${row.key}`,
    ).map(() => this.#databases.evict(row.key))
  }

  /** The identity's membership goes, then its member row leaves the organisation's database. */
  #leaveTenant(identity: IdentityId, row: DepartingMembership): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(membershipRemoveStatement, {
          identity: recordId('identity', identity),
          tenant: recordId('tenant', row.tenant),
        })
        .retry(),
      `could not remove the membership of ${identity} in ${row.key}`,
    ).andThen(() => this.#members.remove(row.key, identity))
  }
}
