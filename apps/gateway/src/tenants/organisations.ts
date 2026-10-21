import { errAsync, okAsync, Result, ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  type LocalDb,
  recordId,
  tenantDatabase,
  tenantRegionId,
} from '@workspace/data'
import { type IdentityId, membershipIdFactory, tenantIdFactory } from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import { KeyedTurns } from '../keyed-turns'

import { OrganisationLookup } from './organisation-lookup'
import { type OrganisationError, refused } from './organisation-refusal'
import { keyOf, type Member, type Tenant, takenIn, toTenant, writing } from './organisation-rows'
import membershipAddStatement from './surql/membership-add.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import tenantCreateStatement from './surql/tenant-create.surql'
import tenantDefineStatement from './surql/tenant-define.surql'
import tenantReadyStatement from './surql/tenant-ready.surql'
import type { TenantDatabases } from './tenant-databases'
import { TenantMembers } from './tenant-members'

export interface OrganisationsOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire' | 'evict'>
  /**
   * Takes the region of an organisation an identity was removed from from that identity's open
   * connections at once; resolves once none of them may name it any more.
   */
  readonly revoke: (identity: IdentityId, region: string) => Promise<void>
}

/** The longest name an organisation may have, in characters. */
const MAX_NAME = 80

/** Hears an identity's new memberships; the change it belongs to resolves once this does. */
type Listener = (identity: IdentityId, memberships: readonly Membership[]) => Promise<void>

/**
 * The organisations of the application and who belongs to them. The directory holds each
 * organisation and every membership; each organisation's own database holds its members, the
 * word its data is checked against. Creating an organisation writes its directory rows, defines
 * its database, adds the creator as its admin member there and marks it ready; until then it is
 * nobody's, and its creator may run the creation again to finish it. A command that fails with
 * a `DataError` after some of its rows were written leaves those rows in place, and asking again
 * completes it: a creation by its creator, an invite, a removal. Each change of memberships
 * resolves once the listeners heard the identity's new memberships.
 *
 * The changes of one identity's memberships (its creations, the invites of it and its
 * removals) run one after the other, each once the one before it, its notification included,
 * has settled: the directory and the organisation's database end as the last one left them,
 * and the listeners hear the lists in that order. This orders them within one gateway process
 * only; gateways running in several processes would need a durable revision of the memberships.
 */
export class Organisations {
  readonly #directory: LocalDb
  readonly #lookup: OrganisationLookup
  readonly #members: TenantMembers
  readonly #databases: Pick<TenantDatabases, 'acquire' | 'evict'>
  readonly #revoke: OrganisationsOptions['revoke']
  readonly #listeners = new Set<Listener>()
  /** Settles once the changes of an identity's memberships asked so far have; gone when idle. */
  readonly #changes = new KeyedTurns<IdentityId>()

  constructor(options: OrganisationsOptions) {
    this.#directory = options.directory
    this.#lookup = new OrganisationLookup(options.directory)
    this.#members = new TenantMembers(options.databases)
    this.#databases = options.databases
    this.#revoke = options.revoke
  }

  /** The ready organisations `identity` belongs to, with its role in each, by key. */
  membershipsOf(identity: IdentityId): ResultAsync<readonly Membership[], DataError> {
    return this.#lookup.membershipsOf(identity)
  }

  /**
   * Creates an organisation with `identity` as its admin. A key taken by another organisation
   * is refused, except one the same identity began to create and never finished: that creation
   * is completed. The name is trimmed first.
   */
  create(input: {
    identity: IdentityId
    key: string
    name: string
  }): ResultAsync<Membership, OrganisationError> {
    const { identity, key } = input
    const name = input.name.trim()
    const length = [...name].length

    if (!isTenantKey(key)) {
      return errAsync(refused('invalid-key'))
    }

    if (length < 1 || length > MAX_NAME) {
      return errAsync(refused('invalid-name'))
    }

    return this.#serialize(identity, () =>
      this.#register(identity, key, name)
        .andThen((tenant) => this.#provision(identity, tenant))
        .andThen((tenant) =>
          this.#emit(identity).map((): Membership => ({ tenant, role: 'admin' })),
        ),
    )
  }

  /**
   * An admin of the organisation adds the identity that signs in with `email` as a member. An
   * identity already in is refused, once its member row in the organisation's database is
   * written again with the role the directory holds: asking again completes an invite that
   * failed after the directory's membership.
   */
  invite(input: {
    actor: IdentityId
    key: string
    email: string
  }): ResultAsync<Member, OrganisationError> {
    const { actor, key, email } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) =>
        this.#lookup.identityByEmail(email).map((identity) => ({ tenant, identity })),
      )
      .andThen(({ tenant, identity }) =>
        this.#serialize(identity.id, () =>
          this.#join(tenant, identity.id)
            .andThen(() => this.#members.add(key, identity.id, 'member'))
            .andThen(() => this.#emit(identity.id))
            .map((): Member => ({ identity, role: 'member' })),
        ),
      )
  }

  /**
   * An admin of the organisation removes `identity` from it; an admin cannot remove itself.
   * Once the directory's membership is gone the organisation's region is taken from the
   * identity's open connections, before anything else can fail; then its member row leaves the
   * organisation's database and its listeners hear its memberships, both tried whatever the
   * other's outcome, the first failure answering. It happens at every removal, also of an
   * identity that was no member: asking again after a failure revokes and tells again, and
   * completes the removal.
   */
  remove(input: {
    actor: IdentityId
    key: string
    identity: IdentityId
  }): ResultAsync<void, OrganisationError> {
    const { actor, key, identity } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) => (identity === actor ? errAsync(refused('self')) : okAsync(tenant)))
      .andThen((tenant) =>
        this.#serialize(identity, () =>
          writing(
            this.#directory.db
              .query(membershipRemoveStatement, {
                identity: recordId('identity', identity),
                tenant: recordId('tenant', tenant.id),
              })
              .retry(),
            `could not remove the membership of ${identity} in ${key}`,
          )
            .andThen(() =>
              ResultAsync.fromPromise(this.#revoke(identity, tenantRegionId(key)), (cause) =>
                dataError(
                  'data:WRITE_FAILED',
                  `could not take ${key} from the connections of ${identity}`,
                  cause,
                ),
              ),
            )
            .andThen(() => this.#leaveTenant(key, identity)),
        ),
      )
  }

  /** The members of the organisation with their emails, for its admins, the earliest first. */
  membersOf(input: {
    actor: IdentityId
    key: string
  }): ResultAsync<readonly Member[], OrganisationError> {
    const { actor, key } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen(() => this.#members.list(key))
      .andThen((rows) => this.#lookup.withEmails(key, rows))
  }

  /** Hears that an identity's memberships changed, with the new list. */
  onChange(listener: Listener): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
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

  /** The organisation `identity` began to create under `key` and never finished, if it did. */
  #unfinished(identity: IdentityId, key: string): ResultAsync<Tenant, OrganisationError> {
    return this.#lookup
      .tenantRow(key)
      .andThen((row) =>
        row && row.status === 'provisioning' && keyOf(row.created_by) === identity
          ? okAsync(toTenant(row))
          : errAsync(refused('key-taken')),
      )
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

  /**
   * The directory's membership of `identity` in the organisation, as a member; one it already
   * has is refused once its member row is restored.
   */
  #join(tenant: Tenant, identity: IdentityId): ResultAsync<void, OrganisationError> {
    return writing(
      this.#directory.db
        .query(membershipAddStatement, {
          id: membershipIdFactory.create(),
          identity: recordId('identity', identity),
          tenant: recordId('tenant', tenant.id),
          role: 'member',
        })
        .retry(),
      `could not add the membership of ${identity} in ${tenant.key}`,
    )
      .map(() => undefined)
      .orElse((error) =>
        takenIn('membership_identity_tenant', error)
          ? this.#restoreMember(tenant, identity).andThen(() =>
              errAsync<void, OrganisationError>(refused('already-member')),
            )
          : errAsync(error),
      )
  }

  /**
   * Writes the member row of an identity the directory already counts in the organisation, with
   * the role the directory holds; nothing when its membership is gone.
   */
  #restoreMember(tenant: Tenant, identity: IdentityId): ResultAsync<void, DataError> {
    return this.#lookup
      .roleOf(tenant, identity)
      .andThen((role) =>
        role === undefined ? okAsync(undefined) : this.#members.add(tenant.key, identity, role),
      )
  }

  /**
   * The member row of `identity` leaves the organisation's database, and its listeners hear its
   * memberships; each runs whatever the other's outcome, and the first failure answers.
   */
  #leaveTenant(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    const run = async (): Promise<Result<void, DataError>> => {
      const deleted = await this.#members.remove(key, identity)
      const told = await this.#emit(identity)

      return Result.combine([deleted, told]).map(() => undefined)
    }

    return new ResultAsync(run())
  }

  /** Tells the listeners the memberships `identity` has now; resolves once each heard them. */
  #emit(identity: IdentityId): ResultAsync<void, DataError> {
    return this.membershipsOf(identity).andThen((memberships) =>
      ResultAsync.fromPromise(
        Promise.all([...this.#listeners].map((listener) => listener(identity, memberships))),
        (cause) =>
          dataError('data:WRITE_FAILED', `could not tell the memberships of ${identity}`, cause),
      ).map(() => undefined),
    )
  }

  /**
   * Runs `work`, a change of the memberships of `identity`, once the changes of that identity
   * asked before it have settled; the next one waits for it, whatever its outcome.
   */
  #serialize<T>(
    identity: IdentityId,
    work: () => ResultAsync<T, OrganisationError>,
  ): ResultAsync<T, OrganisationError> {
    return new ResultAsync(this.#changes.run(identity, work))
  }
}
