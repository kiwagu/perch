/**
 * The signed-in identity's space on this device: its own local database with its private
 * region as a CRDT document projected into it, a database and region of the same kind for each
 * organisation it belongs to, reads and writes routed between them by region and, while this
 * tab leads the browser, the sync engine that keeps every region in step with the gateway. The
 * organisation databases the device holds for the identity are counted in an inventory that
 * outlives the space, so one the space does not open (kept from an earlier session, or one that
 * failed to open) is still deleted once the identity no longer belongs to its organisation, and
 * when the space is destroyed. The inventory and the memberships are shared by the identity's
 * tabs: a tab deletes no database of an organisation the memberships saved for the identity
 * still hold, though the list it follows may be older.
 */

import { okAsync, ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, ShapeRunnerPort, WritePathPort } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'
import type { SyncEngine } from '@workspace/replica/sync'

import { RoutingShapeRunner, RoutingWritePath } from '../routing'
import type { RegionSpace, TenantSpaces } from '../tenant-space'

import { FOLLOWING, LeadingEngine, type Visibility } from './leading-engine'
import { SpaceMemberships } from './memberships'
import type { IdentitySpaceOptions } from './options'
import { RegionReloads } from './region-reloads'
import { TabSync } from './tab-sync'

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
  /**
   * Has the leading tab's engine sign the device out (`SyncEngine.signOut`); `offline` when this
   * tab runs no engine. A change of memberships meanwhile replaces that engine, which ends the
   * sign-out `offline`.
   */
  signOut(network: { readonly online: boolean }): Promise<'signed-out' | 'offline'>
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

export class Space implements IdentitySpace {
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly #own: RegionSpace
  readonly #tenants: TenantSpaces
  readonly #reloads: RegionReloads
  readonly #options: IdentitySpaceOptions
  readonly #leading: LeadingEngine
  readonly #tabSync: TabSync
  readonly #memberships: SpaceMemberships
  #closing: Promise<void> | undefined

  constructor(own: RegionSpace, tenants: TenantSpaces, options: IdentitySpaceOptions) {
    this.#own = own
    this.#tenants = tenants
    this.#options = options
    this.#reloads = new RegionReloads({
      spaces: () => this.#spaces(),
      hints: options.hints,
      onError: options.onError,
    })
    this.runner = new RoutingShapeRunner(
      own.runner,
      () => tenants.currentSpace()?.runner,
      options.schema,
      (listener) => tenants.onChange(listener),
    )

    const path = new RoutingWritePath(own.writePath, () => tenants.currentSpace()?.writePath)

    this.writePath = {
      run: (command, params, meta) =>
        path
          .run(command, params, meta)
          .andTee(() => this.#tabSync.wrote())
          .orTee((error) => this.#stale(error)),
    }
    this.#leading = new LeadingEngine({
      regions: () => this.#spaces().map((space) => space.region),
      transport: options.transport,
      clock: options.clock,
      actor: options.identity.id,
      hints: options.hints,
      replaceRegion: (region, how) => this.#reloads.replace(region, how),
      onState: options.onState,
      onError: (error) => {
        options.onError(error)
        this.#stale(error)
      },
    })
    this.#tabSync = new TabSync({
      leading: this.#leading,
      leadership: options.leadership,
      hints: options.hints,
      reloads: this.#reloads,
      spaces: () => this.#spaces(),
      closing: () => this.#closing !== undefined,
      stale: (error) => this.#stale(error),
      onState: options.onState,
      onError: options.onError,
    })
    this.#memberships = new SpaceMemberships({
      space: options,
      tenants,
      leading: this.#leading,
      closing: () => this.#closing !== undefined,
    })
  }

  get identity(): AuthUser {
    return this.#options.identity
  }

  get sync(): SyncEngine | undefined {
    return this.#leading.current
  }

  flush(): ResultAsync<void, DataError> {
    return ResultAsync.combine(this.#spaces().map((space) => space.flush())).map(() => undefined)
  }

  /**
   * Whether the space holds changes not sent yet, once a change of memberships under way ended. A
   * database the device holds for a membership but could not open counts: nobody can read what it
   * holds.
   */
  unsent(): ResultAsync<boolean, DataError> {
    return ResultAsync.fromSafePromise(this.#memberships.settled()).andThen(() =>
      this.#memberships.unopened().length > 0
        ? okAsync(true)
        : ResultAsync.combine(this.#spaces().map((space) => space.unsent())).map((regions) =>
            regions.some(Boolean),
          ),
    )
  }

  setMemberships(next: readonly Membership[]): Promise<void> {
    return this.#memberships.set(next)
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
    this.#leading.visibility(state)
  }

  /**
   * Has the gateway sign the device out once everything is sent. While a database the device
   * holds for a membership did not open, the gateway is not asked (`offline`), as for a region
   * that stopped syncing: what it holds may be unsent.
   */
  signOut(network: { readonly online: boolean }): Promise<'signed-out' | 'offline'> {
    return this.#memberships.unopened().length > 0
      ? Promise.resolve('offline')
      : this.#leading.signOut(network)
  }

  resumeSync(): void {
    this.#leading.resume()
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()

    return this.#closing
  }

  async destroy(): Promise<void> {
    await this.close()
    await Promise.all([
      ...this.#spaces().map((space) => space.destroy()),
      this.#memberships.deleteCounted(),
    ])
    this.#options.tenantDatabases.drop(this.#tenants.keys())
  }

  /** The identity's own region first, then each organisation's. */
  #spaces(): readonly RegionSpace[] {
    return [this.#own, ...this.#tenants.spaces()]
  }

  /** A region was reset under this tab (by another one, which may not have said so): open it again. */
  #stale(error: DataError): void {
    if (error.code === 'data:REGION_STALE' && !this.#closing) {
      void this.#reloads.reloadStale()
    }
  }

  async #shutDown(): Promise<void> {
    this.#tabSync.stop()
    this.#leading.stop()
    this.#options.leadership?.stop()
    this.#options.hints.close()
    // A change of memberships under way ends first: the databases it opens close with the others.
    await this.#memberships.settled()
    await Promise.all(this.#spaces().map((space) => space.close()))
    this.#options.onState(FOLLOWING)
  }
}
