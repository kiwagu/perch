/**
 * The signed-in identity's space on this device: its own local database, its private region
 * as a CRDT document projected into that database, the write path into the region and, while
 * this tab leads the browser, the sync engine that keeps the region in step with the gateway.
 */

import { errAsync, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  dataError,
  type LocalDb,
  ShapeRunner,
  type ShapeRunnerPort,
  type WritePathPort,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import {
  type Clock,
  LoroWritePath,
  Projector,
  RegionDoc,
  type ReplicaSchema,
} from '@workspace/replica'
import {
  type ChannelState,
  createSyncEngine,
  type Leadership,
  type SyncEngine,
  type SyncHint,
  type SyncHints,
  type SyncTransport,
} from '@workspace/replica/sync'

export type Visibility = 'visible' | 'hidden'

/** Whether this tab leads the browser's sync, and the state of its channel to the gateway. */
export interface SyncState {
  readonly leader: boolean
  readonly channel: ChannelState
}

export interface IdentitySpace {
  readonly identity: AuthUser
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  /** The sync engine while this tab leads; undefined while another tab does. */
  readonly sync: SyncEngine | undefined
  flush(): ResultAsync<void, DataError>
  /** Whether the region holds local changes the gateway has not acknowledged yet. */
  unsent(): ResultAsync<boolean, DataError>
  /** The tab's visibility: the leader's cadence follows it; a follower coming to the front tells the leader. */
  visibility(state: Visibility): void
  /** Stops syncing and leading, persists and projects the last writes, closes the database. */
  close(): Promise<void>
  /** Closes the space and deletes its database. */
  destroy(): Promise<void>
}

export interface IdentitySpaceOptions {
  readonly identity: AuthUser
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
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

class Space implements IdentitySpace {
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly #local: LocalDb
  readonly #region: RegionDoc
  readonly #options: IdentitySpaceOptions
  readonly #projector: Projector
  readonly #stopProjecting: () => void
  readonly #listening: Array<() => void> = []
  #engine: SyncEngine | undefined
  #visibility: Visibility = 'visible'
  #closing: Promise<void> | undefined

  constructor(local: LocalDb, region: RegionDoc, options: IdentitySpaceOptions) {
    this.#local = local
    this.#region = region
    this.#options = options
    this.#projector = new Projector(region, local, options.schema, { onError: options.onError })
    this.#stopProjecting = this.#projector.start()
    this.runner = new ShapeRunner(local)

    const path = new LoroWritePath(region, options.schema)

    this.writePath = {
      run: (command, params, meta) => path.run(command, params, meta).andTee(() => this.#wrote()),
    }
    this.#listening.push(options.hints.on((hint) => this.#hint(hint)))
    this.#followLeadership(options.leadership)
  }

  get identity(): AuthUser {
    return this.#options.identity
  }

  get sync(): SyncEngine | undefined {
    return this.#engine
  }

  flush(): ResultAsync<void, DataError> {
    return this.#region.flush().andThen(() => this.#projector.flush())
  }

  unsent(): ResultAsync<boolean, DataError> {
    return this.#region
      .flush()
      .andThen(() => this.#region.outbox(1))
      .map((rows) => rows.length > 0)
  }

  visibility(state: Visibility): void {
    this.#visibility = state

    if (this.#engine) {
      this.#engine.visibility(state)
    } else if (state === 'visible') {
      this.#options.hints.post('visible')
    }
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()

    return this.#closing
  }

  async destroy(): Promise<void> {
    await this.close()
    await this.#local.destroy()
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
      regions: [this.#region],
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
    }
  }

  #catchUp(): void {
    if (this.#closing) {
      return
    }

    void this.#region.catchUpLocal().match(
      () => undefined,
      (error) => this.#options.onError(error),
    )
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
    this.#stopProjecting()
    // The last writes still persist and project before the database closes; a failure there
    // was already reported to the write that made it, or by the projector.
    await this.#region
      .flush()
      .andThen(() => this.#projector.flush())
      .unwrapOr(undefined)
    this.#region.close()
    this.#options.onState(FOLLOWING)
    await this.#local.close()
  }
}

/** Lets go of what the options handed over, when no space takes them. */
function abandon(options: IdentitySpaceOptions): void {
  options.leadership?.stop()
  options.hints.close()
}

/**
 * Opens the identity's database and its private region `identity:<id>`, projects the region
 * into the database and syncs it while this tab leads. The space owns the leadership and the
 * hints it is given: it stops them when it closes, or at once when it cannot open.
 */
export function openIdentitySpace(
  options: IdentitySpaceOptions,
): ResultAsync<IdentitySpace, DataError> {
  const id = options.identity.id

  return options
    .openLocal(id)
    .orElse((error) => {
      abandon(options)

      return errAsync(error)
    })
    .andThen((local) =>
      RegionDoc.open(local, { kind: 'private', id: `identity:${id}` })
        .map((region): IdentitySpace => new Space(local, region, options))
        .orElse((error) => {
          abandon(options)

          return ResultAsync.fromSafePromise(local.close()).andThen(() => errAsync(error))
        }),
    )
}
