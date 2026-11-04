import { err, errAsync, ok, okAsync, type Result, type ResultAsync } from 'neverthrow'

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

/** A departure refused: the identity is the only admin of a ready organisation with others in it. */
export interface DepartureRefusal {
  readonly kind: 'refused'
  readonly code: 'last-admin'
}

export type DepartureError = DepartureRefusal | DataError

/**
 * What a departure runs in the turns it holds besides its own writes. `before` runs once the
 * departure was found allowed and before it writes anything: its value is the departure's answer,
 * and its error stops the departure with nothing of the organisations changed, a `Stop` of the
 * caller's own type telling a stop it chose apart from a failure (`DataError`). `after` runs once
 * the identity left, its failure the departure's answer.
 */
export interface DepartureSteps<T, Stop> {
  readonly before: () => ResultAsync<T, Stop | DataError>
  readonly after: () => ResultAsync<void, DataError>
}

/** Whether the identity's departure would leave the others of this organisation without an admin. */
function lastAdmin(row: DepartingMembership): boolean {
  return row.status === 'ready' && row.role === 'admin' && row.admins === 1 && row.members > 1
}

export interface AccountDepartureOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire' | 'evict'>
}

/**
 * The organisations of an identity whose account goes. Who is the only member or the last admin
 * of an organisation is the directory's word: its memberships and their roles. An organisation
 * the identity is the only member of goes whole, of any status, one still provisioning too; in
 * any other its member row leaves the organisation's database, then its membership goes, and
 * its notes stay. Its connections are the caller's to close beforehand, and the other members
 * are told nothing: they read the members when they ask for them.
 *
 * `leave` decides from who else belongs to each organisation, so it runs in the identity's turn
 * and in the turns of its organisations (`Organisations.leaveAll`): no other change of their
 * memberships moves those rows between its read and its writes.
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
    return this.#departing(identity).map((rows) => rows.some(lastAdmin))
  }

  /** The ids of the organisations the identity belongs to, of any status. */
  organisationsOf(identity: IdentityId): ResultAsync<readonly string[], DataError> {
    return this.#departing(identity).map((rows) => rows.map((row) => row.tenant))
  }

  /**
   * Every membership of the identity goes, one organisation after the other, the first failure
   * answering; while the identity is the only admin of a ready organisation with others in it,
   * the departure is refused `last-admin` and nothing changes, `before` not run. Otherwise
   * `before` runs first, ahead of every write: its error stops the departure there, and its value
   * is the answer once every membership went. An organisation it is the only member of goes
   * whole: its database, its memberships and its directory row in one transaction, then the
   * cached connection to it. In any other its member row goes first and its membership last, so a
   * run again after a failure still finds every organisation it has not left yet and completes
   * the departure; a run after a success finds nothing and changes nothing.
   */
  leave<T, Stop>(
    identity: IdentityId,
    before: DepartureSteps<T, Stop>['before'],
  ): ResultAsync<T, DepartureError | Stop> {
    return this.#departing(identity).andThen((rows) =>
      rows.some(lastAdmin)
        ? errAsync<T, DepartureError | Stop>({ kind: 'refused', code: 'last-admin' })
        : before().andThen((value) =>
            rows
              .reduce(
                (done, row) =>
                  done.andThen(() =>
                    row.members === 1 ? this.#removeTenant(row) : this.#leaveTenant(identity, row),
                  ),
                okAsync<void, DataError>(undefined),
              )
              .map(() => value),
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

  /**
   * The identity's member row leaves the organisation's database, then its membership goes: the
   * membership is what a run again finds, so it goes last.
   */
  #leaveTenant(identity: IdentityId, row: DepartingMembership): ResultAsync<void, DataError> {
    return this.#members.remove(row.key, identity).andThen(() =>
      writing(
        this.#directory.db
          .query(membershipRemoveStatement, {
            identity: recordId('identity', identity),
            tenant: recordId('tenant', row.tenant),
          })
          .retry(),
        `could not remove the membership of ${identity} in ${row.key}`,
      ).map(() => undefined),
    )
  }
}
