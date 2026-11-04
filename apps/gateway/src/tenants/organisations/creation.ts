import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, recordId, tenantDatabase } from '@workspace/data'
import { type IdentityId, membershipIdFactory, tenantIdFactory } from '@workspace/ids'

import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import { keyOf, type Tenant, takenIn, toTenant, writing } from '../organisation-rows'
import tenantCreateStatement from '../surql/tenant-create.surql'
import tenantDefineStatement from '../surql/tenant-define.surql'
import tenantReadyStatement from '../surql/tenant-ready.surql'
import type { TenantDatabases } from '../tenant-databases'
import type { TenantMembers } from '../tenant-members'

export interface OrganisationCreationOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'evict'>
  readonly lookup: OrganisationLookup
  readonly members: TenantMembers
}

/**
 * The creation of an organisation: its directory rows with its creator's admin membership, its
 * database, its creator as admin member there, then ready. Until then it is nobody's, and its
 * creator may run the creation again to finish it.
 */
export class OrganisationCreation {
  readonly #directory: LocalDb
  readonly #databases: Pick<TenantDatabases, 'evict'>
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers

  constructor(options: OrganisationCreationOptions) {
    this.#directory = options.directory
    this.#databases = options.databases
    this.#lookup = options.lookup
    this.#members = options.members
  }

  /**
   * The organisation `identity` creates under `key`, ready. A key taken by another organisation
   * is refused, except one the same identity began to create and never finished, or created and
   * is still the admin of: that creation is completed, under the name it was stored with.
   */
  create(identity: IdentityId, key: string, name: string): ResultAsync<Tenant, OrganisationError> {
    return this.#register(identity, key, name).andThen((tenant) =>
      this.#provision(identity, tenant),
    )
  }

  /**
   * Writes the organisation's directory rows, still provisioning, with its creator's admin
   * membership; or, when its key is taken, finds the creation the same identity left unfinished.
   */
  #register(
    identity: IdentityId,
    key: string,
    name: string,
  ): ResultAsync<Tenant, OrganisationError> {
    const tenant: Tenant = { id: tenantIdFactory.create(), key, name }

    return writing(
      this.#directory.db
        .query(tenantCreateStatement, {
          id: tenant.id,
          membership: membershipIdFactory.create(),
          key,
          name,
          database: tenantDatabase(key),
          identity: recordId('identity', identity),
        })
        .retry(),
      `could not create organisation ${key}`,
    )
      .map(() => tenant)
      .orElse((error) =>
        takenIn('tenant_key', error) ? this.#unfinished(identity, key) : errAsync(error),
      )
  }

  /**
   * The organisation `identity` began to create under `key`, for its creation to be completed:
   * one still provisioning, or one ready whose creator is still its admin (telling the listeners
   * failed). Any other organisation under the key is refused as taken.
   */
  #unfinished(identity: IdentityId, key: string): ResultAsync<Tenant, OrganisationError> {
    return this.#lookup.tenantRow(key).andThen((row): ResultAsync<Tenant, OrganisationError> => {
      if (!row || keyOf(row.created_by) !== identity) {
        return errAsync(refused('key-taken'))
      }

      const tenant = toTenant(row)

      return row.status === 'provisioning'
        ? okAsync(tenant)
        : this.#lookup
            .adminOf(identity, tenant)
            .orElse((error) => errAsync('kind' in error ? refused('key-taken') : error))
    })
  }

  /** Defines the organisation's database, adds its creator as admin there and marks it ready. */
  #provision(identity: IdentityId, tenant: Tenant): ResultAsync<Tenant, DataError> {
    const { key } = tenant

    return writing(
      this.#directory.db.query(tenantDefineStatement, { database: tenantDatabase(key) }).retry(),
      `could not define the database of ${key}`,
    )
      .andThen(() => {
        // The database was just (re)defined: a connection cached from before it was removed
        // would not have the schema applied.
        this.#databases.evict(key)

        return this.#members.add(key, identity, 'admin')
      })
      .andThen(() =>
        writing(
          this.#directory.db.query(tenantReadyStatement, { id: tenant.id }).retry(),
          `could not mark ${key} ready`,
        ),
      )
      .map(() => tenant)
  }
}
