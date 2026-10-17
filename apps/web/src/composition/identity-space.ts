/**
 * The signed-in identity's space on this device: its own local database with its private
 * region as a CRDT document projected into it, a database and region of the same kind for each
 * organisation it belongs to, reads and writes routed between them by region and, while this
 * tab leads the browser, the sync engine that keeps every region in step with the gateway. The
 * organisation databases the device holds for the identity are counted in an inventory that
 * outlives the space, so one the space does not open (kept from an earlier session, or one that
 * failed to open) is still deleted once the identity no longer belongs to its organisation, and
 * when the space is destroyed.
 */

import { errAsync, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  dataError,
  type LocalDb,
  type ShapeRunnerPort,
  type WritePathPort,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { type Clock, privateRegionId, type ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import {
  type ChannelState,
  createSyncEngine,
  type Leadership,
  type SyncEngine,
  type SyncHint,
  type SyncHints,
  type SyncTransport,
} from '@workspace/replica/sync'

import { RoutingShapeRunner, RoutingWritePath } from './routing'
import { openRegionSpace, type RegionSpace, TenantSpaces } from './tenant-space'

export type Visibility = 'visible' | 'hidden'

/** Whether this tab leads the browser's sync, and the state of its channel to the gateway. */
export interface SyncState {
  readonly leader: boolean
  readonly channel: ChannelState
}

export interface IdentitySpace {
  readonly identity: AuthUser
  /**
   * Reads the current organisation's database for a shape over the tenant region, the identity's
   * otherwise; a watch over the tenant region moves when another organisation becomes current.
   */
  readonly runner: ShapeRunnerPort
  /** Writes a command into the tenant region of the current organisation, any other into the private region. */
  readonly writePath: WritePathPort
  /** The sync engine while this tab leads; undefined while another tab does. */
  readonly sync: SyncEngine | undefined
  /** Resolves once every local write so far, in every region, is durable and projected. */
  flush(): ResultAsync<void, DataError>
  /**
   * Whether any region holds local changes the gateway has not acknowledged yet: outbox rows,
   * or a change whose append failed and so lives in memory only.
   */
  unsent(): ResultAsync<boolean, DataError>
  /**
   * The identity's organisations changed: the databases of new ones open, those of the ones it
   * left close and are deleted, as are those the device holds of other organisations it no
   * longer belongs to, and a leading tab syncs the regions on a new engine. Changes run one
   * after the other; one that leaves the databases as they are changes nothing, and one that
   * fails is reported, never rejected, so the next one still runs and the space still closes.
   */
  setMemberships(next: readonly Membership[]): Promise<void>
  /** Makes the open organisation `key` current, or none; a key whose database is not open changes nothing. */
  selectTenant(key: string | undefined): void
  /** The key of the current organisation: the one selected, or the first by key while that one is not open. */
  currentTenant(): string | undefined
  /** The organisations the identity belongs to, as the space was last told. */
  memberships(): readonly Membership[]
  /** The keys of the organisations whose databases are open, in order. */
  tenants(): readonly string[]
  /** The tab's visibility: the leader's cadence follows it; a follower coming to the front tells the leader. */
  visibility(state: Visibility): void
  /** Has the leading tab's engine connect again at once; nothing happens while another tab leads. */
  reconnectSync(): void
  /**
   * Has this tab sync again after a sign-out that asked the gateway in vain, which stopped the
   * engine's channel: as on a change of leader, a new engine over a new channel replaces it
   * (an engine never starts twice). Nothing happens while another tab leads, or while the
   * engine's channel was not stopped.
   */
  resumeSync(): void
  /** Stops syncing and leading, persists and projects the last writes, closes every database. */
  close(): Promise<void>
  /**
   * Closes the space and deletes its databases: the identity's own and every organisation
   * database the device holds for it, open or not. One not open that cannot be deleted is
   * reported and stays counted.
   */
  destroy(): Promise<void>
}

/** The organisation databases this device may hold for an identity, kept across its sessions. */
export interface TenantDatabaseInventory {
  /** Their keys, those of databases not open included. */
  keys(): readonly string[]
  /** Counts the databases of `keys`, before they open. */
  add(keys: readonly string[]): void
  /** Stops counting the databases of `keys`, once they are deleted. */
  drop(keys: readonly string[]): void
}

export interface IdentitySpaceOptions {
  readonly identity: AuthUser
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Opens the database of one organisation of the identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of the identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  /** The organisation databases the device holds for the identity. */
  readonly tenantDatabases: TenantDatabaseInventory
  /** The organisations the identity belongs to, as the device last heard. */
  readonly memberships: readonly Membership[]
  /** The key of the organisation chosen last on this browser, if any. */
  readonly tenant: string | undefined
  readonly schema: ReplicaSchema
  /** Builds the channel to the gateway when this tab starts to lead: a WebSocketTransport in the app, the gateway stub in tests. */
  readonly transport: () => SyncTransport
  readonly leadership: Leadership | undefined
  readonly hints: SyncHints
  readonly clock: Clock
  readonly onState: (state: SyncState) => void
  readonly onError: (error: DataError) => void
}

const FOLLOWING: SyncState = { leader: false, channel: 'down' }

/** The keys of the organisations of `memberships`. */
function keysOf(memberships: readonly Membership[]): ReadonlySet<string> {
  return new Set(memberships.map(({ tenant }) => tenant.key))
}

class Space implements IdentitySpace {
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly #own: RegionSpace
  readonly #tenants: TenantSpaces
  readonly #options: IdentitySpaceOptions
  readonly #listening: Array<() => void> = []
  #engine: SyncEngine | undefined
  #visibility: Visibility = 'visible'
  #closing: Promise<void> | undefined
  /** The change of memberships under way, if any; the next one waits for it. It never rejects. */
  #changing: Promise<void> = Promise.resolve()

  constructor(own: RegionSpace, tenants: TenantSpaces, options: IdentitySpaceOptions) {
    this.#own = own
    this.#tenants = tenants
    this.#options = options
    this.runner = new RoutingShapeRunner(
      own.runner,
      () => tenants.currentSpace()?.runner,
      options.schema,
      (listener) => tenants.onChange(listener),
    )

    const path = new RoutingWritePath(own.writePath, () => tenants.currentSpace()?.writePath)

    this.writePath = {
      run: (command, params, meta) => path.run(command, params, meta).andTee(() => this.#wrote()),
    }
    this.#listening.push(options.hints.on((hint) => this.#hint(hint)))
    this.#followLeadership(options.leadership)
    // The databases the device holds of organisations the identity left meanwhile go first.
    this.#changing = this.#deleteRetained(keysOf(options.memberships))
  }

  get identity(): AuthUser {
    return this.#options.identity
  }

  get sync(): SyncEngine | undefined {
    return this.#engine
  }

  flush(): ResultAsync<void, DataError> {
    return ResultAsync.combine(this.#spaces().map((space) => space.flush())).map(() => undefined)
  }

  unsent(): ResultAsync<boolean, DataError> {
    return ResultAsync.combine(this.#spaces().map((space) => space.unsent())).map((regions) =>
      regions.some(Boolean),
    )
  }

  setMemberships(next: readonly Membership[]): Promise<void> {
    this.#changing = this.#changing
      .then(() => this.#changeMemberships(next))
      .catch((cause: unknown) =>
        this.#options.onError(
          dataError('data:OPEN_FAILED', 'could not follow a change of the memberships', cause),
        ),
      )

    return this.#changing
  }

  selectTenant(key: string | undefined): void {
    this.#tenants.select(key)
  }

  currentTenant(): string | undefined {
    return this.#tenants.current()
  }

  memberships(): readonly Membership[] {
    return this.#tenants.memberships()
  }

  tenants(): readonly string[] {
    return this.#tenants.keys()
  }

  visibility(state: Visibility): void {
    this.#visibility = state

    if (this.#engine) {
      this.#engine.visibility(state)
    } else if (state === 'visible') {
      this.#options.hints.post('visible')
    }
  }

  reconnectSync(): void {
    this.#engine?.reconnect()
  }

  resumeSync(): void {
    if (this.#engine?.channelStopped()) {
      this.#relead()
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()

    return this.#closing
  }

  async destroy(): Promise<void> {
    await this.close()
    await Promise.all([
      ...this.#spaces().map((space) => space.destroy()),
      this.#deleteRetained(new Set()),
    ])
    this.#options.tenantDatabases.drop(this.#tenants.keys())
  }

  /** The identity's own region first, then each organisation's. */
  #spaces(): readonly RegionSpace[] {
    return [this.#own, ...this.#tenants.spaces()]
  }

  /** The engine stops before a database the identity left goes: the next one syncs only those still open. */
  async #changeMemberships(next: readonly Membership[]): Promise<void> {
    if (this.#closing) {
      return
    }

    const keys = keysOf(next)

    this.#options.tenantDatabases.add([...keys])

    const { changed, left } = await this.#tenants.change(next)

    if (changed) {
      this.#relead()
    }

    this.#options.tenantDatabases.drop(await this.#tenants.delete(left))
    await this.#deleteRetained(keys)
  }

  /**
   * Deletes the organisation databases the device holds for the identity that are neither open
   * nor of `keep`, and stops counting those deleted; one that cannot be deleted is reported and
   * stays counted, for a later change or sign-out to try again. Never rejects.
   */
  async #deleteRetained(keep: ReadonlySet<string>): Promise<void> {
    const open = new Set(this.#tenants.keys())
    const retained = this.#options.tenantDatabases
      .keys()
      .filter((key) => !keep.has(key) && !open.has(key))
    const deleted = await Promise.all(
      retained.map((key) =>
        this.#options.deleteTenantLocal(this.identity.id, key).match(
          () => [key],
          (error) => {
            this.#options.onError(error)

            return []
          },
        ),
      ),
    )

    this.#options.tenantDatabases.drop(deleted.flat())
  }

  #followLeadership(leadership: Leadership | undefined): void {
    if (!leadership) {
      this.#options.onError(
        dataError(
          'data:SYNC_STOPPED',
          'Web Locks are not available in this browser, so no tab can lead the sync: this device does not sync',
        ),
      )
      this.#options.onState(FOLLOWING)

      return
    }

    this.#listening.push(leadership.onChange((leader) => (leader ? this.#lead() : this.#follow())))

    if (leadership.isLeader()) {
      this.#lead()
    } else {
      this.#options.onState(FOLLOWING)
    }
  }

  /** This tab starts to lead: a new engine over a new channel (an engine never starts twice). */
  #lead(): void {
    if (this.#engine || this.#closing) {
      return
    }

    const engine = createSyncEngine({
      regions: this.#spaces().map((space) => space.region),
      transport: this.#options.transport(),
      clock: this.#options.clock,
      actor: this.identity.id,
      onState: ({ channel }) => {
        if (this.#engine === engine) {
          this.#options.onState({ leader: true, channel })
        }
      },
      onSettled: () => this.#options.hints.post('settled'),
      // Work a stopped engine still had under way fails once the database closes under it;
      // that is not reported: what it did not store, the next leader pulls again.
      onError: (error) => {
        if (this.#engine === engine) {
          this.#options.onError(error)
        }
      },
    })

    this.#engine = engine
    engine.visibility(this.#visibility)
    this.#options.onState({ leader: true, channel: 'down' })
    engine.start()
  }

  /** A leading tab replaces its engine with a new one over a new channel; a follower has none. */
  #relead(): void {
    const engine = this.#engine

    if (!engine) {
      return
    }

    this.#engine = undefined
    engine.stop()
    this.#lead()
  }

  /** Another tab leads now: this one stops syncing. */
  #follow(): void {
    const engine = this.#engine

    this.#engine = undefined
    engine?.stop()
    this.#options.onState(FOLLOWING)
  }

  /** A write of this tab is durable: the leader drains it, the other tabs read it from the log. */
  #wrote(): void {
    this.#engine?.localWrite()
    this.#options.hints.post('journal')
  }

  #hint(hint: SyncHint): void {
    switch (hint) {
      // Another tab wrote to the log: read it, and drain it when leading.
      case 'journal':
        this.#catchUp()
        this.#engine?.localWrite()
        break
      // The leader imported from the gateway into the log.
      case 'settled':
        this.#catchUp()
        break
      case 'visible':
        this.#engine?.visibility('visible')
        break
      case 'kick':
        this.#engine?.localWrite()
        break
      // Another tab began a sign-out: the session holds this tab's writes back.
      case 'sign-out':
        break
      // Another tab needs new keys: the gateway renews them when the leader connects again.
      case 'renew':
        this.#engine?.reconnect()
        break
    }
  }

  #catchUp(): void {
    if (this.#closing) {
      return
    }

    for (const space of this.#spaces()) {
      void space.catchUp().match(
        () => undefined,
        (error) => this.#options.onError(error),
      )
    }
  }

  async #shutDown(): Promise<void> {
    for (const stop of this.#listening.splice(0)) {
      stop()
    }

    const engine = this.#engine

    this.#engine = undefined
    engine?.stop()
    this.#options.leadership?.stop()
    this.#options.hints.close()
    // A change of memberships under way ends first: the databases it opens close with the others.
    await this.#changing
    await Promise.all(this.#spaces().map((space) => space.close()))
    this.#options.onState(FOLLOWING)
  }
}

/** Lets go of what the options handed over, when no space takes them. */
function abandon(options: IdentitySpaceOptions): void {
  options.leadership?.stop()
  options.hints.close()
}

/**
 * Opens the identity's database and its private region `identity:<id>`, and the database and
 * region `tenant:<key>` of each organisation it belongs to, projects each region into its
 * database and syncs them while this tab leads. The space owns the leadership and the hints it
 * is given: it stops them when it closes, or at once when it cannot open.
 */
export function openIdentitySpace(
  options: IdentitySpaceOptions,
): ResultAsync<IdentitySpace, DataError> {
  const id = options.identity.id

  // Counted before they open: a database that opens only in part is still found and deleted.
  options.tenantDatabases.add([...keysOf(options.memberships)])

  return openRegionSpace({
    openLocal: () => options.openLocal(id),
    ref: { kind: 'private', id: privateRegionId(id) },
    schema: options.schema,
    onError: options.onError,
  })
    .orElse((error) => {
      abandon(options)

      return errAsync(error)
    })
    .andThen((own) =>
      TenantSpaces.open(
        {
          identity: id,
          openLocal: options.openTenantLocal,
          schema: options.schema,
          onError: options.onError,
        },
        options.memberships,
        options.tenant,
      )
        .map((tenants): IdentitySpace => new Space(own, tenants, options))
        .orElse((error) => {
          abandon(options)

          return ResultAsync.fromSafePromise(own.close()).andThen(() => errAsync(error))
        }),
    )
}
