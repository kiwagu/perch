import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
  fromDriverValue,
  type LocalDb,
  recordId,
  tenantDatabase,
  tenantRegionId,
} from '@workspace/data'
import {
  type IdentityId,
  identityIdFactory,
  membershipIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { isTenantKey } from '@workspace/kernel'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import identitiesByIdStatement from './surql/identities-by-id.surql'
import identityByEmailStatement from './surql/identity-by-email.surql'
import memberAddStatement from './surql/member-add.surql'
import memberRemoveStatement from './surql/member-remove.surql'
import membersOfStatement from './surql/members-of.surql'
import membershipAddStatement from './surql/membership-add.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import membershipRoleStatement from './surql/membership-role.surql'
import membershipsOfStatement from './surql/memberships-of.surql'
import tenantByKeyStatement from './surql/tenant-by-key.surql'
import tenantCreateStatement from './surql/tenant-create.surql'
import tenantDefineStatement from './surql/tenant-define.surql'
import tenantReadyStatement from './surql/tenant-ready.surql'
import type { TenantDatabases } from './tenant-databases'

export type OrganisationRefusalCode =
  | 'invalid-key'
  | 'invalid-name'
  | 'key-taken'
  | 'no-such-tenant'
  | 'not-a-member'
  | 'not-admin'
  | 'no-such-identity'
  | 'already-member'
  | 'self'

/** An organisation command refused for what was asked, not for a failure of the gateway. */
export interface OrganisationRefusal {
  readonly kind: 'refused'
  readonly code: OrganisationRefusalCode
}

export type OrganisationError = OrganisationRefusal | DataError

/** A member of an organisation as its members see it: the identity, its email and its role. */
export interface Member {
  readonly identity: { readonly id: IdentityId; readonly email: string }
  readonly role: TenantRole
}

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

/** An organisation as the directory holds it. */
interface Tenant {
  readonly id: string
  readonly key: string
  readonly name: string
}

/** The directory's row of an organisation; record ids come as the driver's own values. */
interface TenantRow {
  readonly id: unknown
  readonly key: string
  readonly name: string
  readonly database: string
  readonly status: 'provisioning' | 'ready'
  readonly created_by: unknown
}

/** A membership with its organisation's id, key and name, as `memberships-of` reads it. */
interface MembershipRow {
  readonly role: TenantRole
  readonly id: unknown
  readonly key: string
  readonly name: string
}

interface IdentityRow {
  readonly id: unknown
  readonly email: string
}

/** A row of an organisation's member table, keyed by the identity's key. */
interface MemberRow {
  readonly id: unknown
  readonly role: TenantRole
}

/** Hears an identity's new memberships; the change it belongs to resolves once this does. */
type Listener = (identity: IdentityId, memberships: readonly Membership[]) => Promise<void>

function refused(code: OrganisationRefusalCode): OrganisationRefusal {
  return { kind: 'refused', code }
}

/** The key of a record id as the driver returns it. */
function keyOf(id: unknown): string {
  return String(fromDriverValue(id))
}

/** Whether the database refused a write because the unique index `index` already holds its value. */
function takenIn(index: string, error: DataError): boolean {
  const message = error.cause instanceof Error ? error.cause.message : String(error.cause)

  return message.startsWith(`Database index \`${index}\` already contains `)
}

/** A read of the database, as a result. */
function reading<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:QUERY_FAILED', message, cause))
}

/**
 * A write to the database, as a result. Every write here is sent with the driver's `retry()`:
 * the database may refuse one as a conflict with a concurrent transaction, and each of them may
 * be replayed.
 */
function writing<T>(query: PromiseLike<T>, message: string): ResultAsync<T, DataError> {
  return ResultAsync.fromPromise(query, (cause) => dataError('data:WRITE_FAILED', message, cause))
}

function identityIdOf(key: string): Result<IdentityId, DataError> {
  return identityIdFactory.is(key)
    ? ok(key)
    : err(dataError('data:QUERY_FAILED', `${key} is not an identity id`))
}

function toTenant(row: TenantRow): Tenant {
  return { id: keyOf(row.id), key: row.key, name: row.name }
}

function toMembership(row: MembershipRow): Membership {
  return { tenant: { id: keyOf(row.id), key: row.key, name: row.name }, role: row.role }
}

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
  readonly #databases: Pick<TenantDatabases, 'acquire' | 'evict'>
  readonly #revoke: OrganisationsOptions['revoke']
  readonly #listeners = new Set<Listener>()
  /** Settles once the changes of an identity's memberships asked so far have; gone when idle. */
  readonly #changes = new Map<IdentityId, Promise<void>>()

  constructor(options: OrganisationsOptions) {
    this.#directory = options.directory
    this.#databases = options.databases
    this.#revoke = options.revoke
  }

  /** The ready organisations `identity` belongs to, with its role in each, by key. */
  membershipsOf(identity: IdentityId): ResultAsync<readonly Membership[], DataError> {
    return reading(
      this.#directory.db.query<[MembershipRow[]]>(membershipsOfStatement, {
        identity: recordId('identity', identity),
      }),
      `could not read the memberships of ${identity}`,
    ).map(([rows]) => rows.map(toMembership))
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

    return this.#tenantOf(key)
      .andThen((tenant) => this.#adminOf(actor, tenant))
      .andThen((tenant) => this.#identityByEmail(email).map((identity) => ({ tenant, identity })))
      .andThen(({ tenant, identity }) =>
        this.#serialize(identity.id, () =>
          this.#join(tenant, identity.id)
            .andThen(() => this.#addMember(key, identity.id, 'member'))
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

    return this.#tenantOf(key)
      .andThen((tenant) => this.#adminOf(actor, tenant))
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

    return this.#tenantOf(key)
      .andThen((tenant) => this.#adminOf(actor, tenant))
      .andThen(() =>
        this.#inTenant(key, (local) =>
          reading(
            local.db.query<[MemberRow[]]>(membersOfStatement),
            `could not read the members of ${key}`,
          ),
        ),
      )
      .andThen(([rows]) => this.#withEmails(key, rows))
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
    return this.#tenantRow(key).andThen((row) =>
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

        return this.#addMember(key, identity, 'admin')
      })
      .andThen(() =>
        writing(
          this.#directory.db.query(tenantReadyStatement, { id: tenant.id }).retry(),
          `could not mark ${key} ready`,
        ),
      )
      .map(() => tenant)
  }

  #tenantRow(key: string): ResultAsync<TenantRow | undefined, DataError> {
    return reading(
      this.#directory.db.query<[TenantRow | undefined]>(tenantByKeyStatement, { key }),
      `could not read organisation ${key}`,
    ).map(([row]) => row)
  }

  /** The ready organisation with `key`; one still provisioning is not there yet. */
  #tenantOf(key: string): ResultAsync<Tenant, OrganisationError> {
    return this.#tenantRow(key).andThen((row) =>
      row?.status === 'ready' ? okAsync(toTenant(row)) : errAsync(refused('no-such-tenant')),
    )
  }

  /** `actor`'s role in the organisation; an identity that does not belong to it is refused. */
  #memberOf(actor: IdentityId, tenant: Tenant): ResultAsync<TenantRole, OrganisationError> {
    return this.membershipsOf(actor).andThen((memberships) => {
      const membership = memberships.find((each) => each.tenant.id === tenant.id)

      return membership ? okAsync(membership.role) : errAsync(refused('not-a-member'))
    })
  }

  /** The organisation, once `actor` proved to be one of its admins. */
  #adminOf(actor: IdentityId, tenant: Tenant): ResultAsync<Tenant, OrganisationError> {
    return this.#memberOf(actor, tenant).andThen((role) =>
      role === 'admin' ? okAsync(tenant) : errAsync(refused('not-admin')),
    )
  }

  #identityByEmail(email: string): ResultAsync<Member['identity'], OrganisationError> {
    return reading(
      this.#directory.db.query<[IdentityRow | undefined]>(identityByEmailStatement, { email }),
      'could not look an identity up by its email',
    ).andThen(([row]) =>
      row
        ? identityIdOf(keyOf(row.id)).map((id) => ({ id, email: row.email }))
        : err(refused('no-such-identity')),
    )
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
    return reading(
      this.#directory.db.query<[TenantRole | undefined]>(membershipRoleStatement, {
        identity: recordId('identity', identity),
        tenant: recordId('tenant', tenant.id),
      }),
      `could not read the role of ${identity} in ${tenant.key}`,
    ).andThen(([role]) =>
      role === undefined ? okAsync(undefined) : this.#addMember(tenant.key, identity, role),
    )
  }

  /** Writes the member row of `identity` with `role` in the organisation's database. */
  #addMember(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, DataError> {
    return this.#inTenant(key, (local) =>
      writing(
        local.db.query(memberAddStatement, { identity, role }).retry(),
        `could not add ${identity} to the members of ${key}`,
      ),
    ).map(() => undefined)
  }

  /** The members with the emails the directory holds for their identities, in the same order. */
  #withEmails(key: string, rows: readonly MemberRow[]): ResultAsync<readonly Member[], DataError> {
    return Result.combine(
      rows.map((row) => identityIdOf(keyOf(row.id)).map((id) => ({ id, role: row.role }))),
    )
      .asyncAndThen((members) =>
        reading(
          this.#directory.db.query<[IdentityRow[]]>(identitiesByIdStatement, {
            ids: members.map((member) => recordId('identity', member.id)),
          }),
          `could not read the identities of the members of ${key}`,
        ).map(([identities]) => ({ members, identities })),
      )
      .andThen(({ members, identities }) => {
        const emails = new Map(identities.map((row) => [keyOf(row.id), row.email]))

        return Result.combine(
          members.map(({ id, role }) => {
            const email = emails.get(id)

            return email === undefined
              ? err(dataError('data:QUERY_FAILED', `member ${id} of ${key} has no identity`))
              : ok<Member, DataError>({ identity: { id, email }, role })
          }),
        )
      })
  }

  /**
   * The member row of `identity` leaves the organisation's database, and its listeners hear its
   * memberships; each runs whatever the other's outcome, and the first failure answers.
   */
  #leaveTenant(key: string, identity: IdentityId): ResultAsync<void, DataError> {
    const run = async (): Promise<Result<void, DataError>> => {
      const deleted = await this.#inTenant(key, (local) =>
        writing(
          local.db.query(memberRemoveStatement, { identity }).retry(),
          `could not remove ${identity} from the members of ${key}`,
        ),
      )
      const told = await this.#emit(identity)

      return Result.combine([deleted.map(() => undefined), told]).map(() => undefined)
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
    const run = (this.#changes.get(identity) ?? Promise.resolve()).then(() => work())
    const settled = run.then(
      () => undefined,
      () => undefined,
    )

    this.#changes.set(identity, settled)
    void settled.then(() => {
      if (this.#changes.get(identity) === settled) {
        this.#changes.delete(identity)
      }
    })

    return new ResultAsync(run)
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
