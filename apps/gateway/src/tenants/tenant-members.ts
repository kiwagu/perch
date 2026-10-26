import { type Result, ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

import { type MemberRow, reading, writing } from './organisation-rows'
import memberAddStatement from './surql/member-add.surql'
import memberRemoveStatement from './surql/member-remove.surql'
import membersOfStatement from './surql/members-of.surql'
import type { TenantDatabases } from './tenant-databases'

/**
 * The member table of each organisation's own database, the word its data is checked against.
 * Each call holds the organisation's database until it settles.
 */
export class TenantMembers {
  readonly #databases: Pick<TenantDatabases, 'acquire'>

  constructor(databases: Pick<TenantDatabases, 'acquire'>) {
    this.#databases = databases
  }

  /** The member rows of the organisation, the earliest first. */
  list(key: string): ResultAsync<readonly MemberRow[], DataError> {
    return this.#inTenant(key, (local) =>
      reading(
        local.db.query<[MemberRow[]]>(membersOfStatement),
        `could not read the members of ${key}`,
      ),
    ).map(([rows]) => rows)
  }

  /** Writes the member row of `identity` with `role` in the organisation's database. */
  add(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, DataError> {
    return this.#inTenant(key, (local) =>
      writing(
        local.db.query(memberAddStatement, { identity, role }).retry(),
        `could not add ${identity} to the members of ${key}`,
      ),
    ).map(() => undefined)
  }

  /** Removes the member row of `identity` from the organisation's database. */
  remove(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    return this.#inTenant(key, (local) =>
      writing(
        local.db.query(memberRemoveStatement, { identity }).retry(),
        `could not remove ${identity} from the members of ${key}`,
      ),
    ).map(() => undefined)
  }

  /** Runs `work` on the organisation's database, holding it until the work settles. */
  #inTenant<T>(
    key: string,
    work: (local: LocalDb) => ResultAsync<T, DataError>,
  ): ResultAsync<T, DataError> {
    return this.#databases.acquire(key).andThen((handle) => {
      const run = async (): Promise<Result<T, DataError>> => {
        try {
          return await work(handle.local)
        } finally {
          handle.release()
        }
      }

      return new ResultAsync(run())
    })
  }
}
