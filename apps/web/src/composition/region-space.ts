/**
 * One region's database on this device: the region document, loaded from the database and
 * projected into it, a runner over the database and the write path into the document. The
 * identity's own database holds its private region this way, and each organisation's database
 * its tenant region (`openTenantSpace`).
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import {
  type DataError,
  type LocalDb,
  ShapeRunner,
  type ShapeRunnerPort,
  type WritePathPort,
} from '@workspace/data'
import {
  LoroWritePath,
  Projector,
  RegionDoc,
  type RegionRef,
  type ReplicaSchema,
} from '@workspace/replica'

export interface RegionSpace {
  readonly region: RegionDoc
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  /** Resolves once every local write so far is durable and projected; reports one that is not durable. */
  flush(): ResultAsync<void, DataError>
  /**
   * Whether the region holds local changes the gateway has not acknowledged yet: outbox rows,
   * or a change whose append failed and so lives in memory only.
   */
  unsent(): ResultAsync<boolean, DataError>
  /** Reads what other tabs wrote to the region's log since the last time. */
  catchUp(): ResultAsync<number, DataError>
  /** Stops projecting, persists and projects the last writes, closes the database. */
  close(): Promise<void>
  /** Closes the database and deletes it. */
  destroy(): Promise<void>
}

export interface RegionSpaceOptions {
  readonly openLocal: () => ResultAsync<LocalDb, DataError>
  readonly ref: RegionRef
  readonly schema: ReplicaSchema
  /** Hears a record whose projection failed. */
  readonly onError: (error: DataError) => void
}

export class OpenRegion implements RegionSpace {
  readonly runner: ShapeRunnerPort
  readonly writePath: WritePathPort
  readonly #projector: Projector
  readonly #stopProjecting: () => void
  #closing: Promise<void> | undefined

  constructor(
    readonly region: RegionDoc,
    private readonly local: LocalDb,
    options: RegionSpaceOptions,
  ) {
    this.#projector = new Projector(region, local, options.schema, { onError: options.onError })
    this.#stopProjecting = this.#projector.start()
    this.runner = new ShapeRunner(local)
    this.writePath = new LoroWritePath(region, options.schema)
  }

  flush(): ResultAsync<void, DataError> {
    return this.region.flush().andThen(() => this.#projector.flush())
  }

  unsent(): ResultAsync<boolean, DataError> {
    // A failed append was reported to the write that made it; its change is unsent all the same.
    return this.region
      .flush()
      .map(() => true)
      .orElse(() => okAsync(false))
      .andThen((durable) =>
        durable ? this.region.outbox(1).map((rows) => rows.length > 0) : okAsync(true),
      )
  }

  catchUp(): ResultAsync<number, DataError> {
    return this.region.catchUpLocal()
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()

    return this.#closing
  }

  async destroy(): Promise<void> {
    await this.close()
    await this.local.destroy()
  }

  async #shutDown(): Promise<void> {
    this.#stopProjecting()
    // The last writes still persist and project before the database closes; a failure there
    // was already reported to the write that made it, or by the projector.
    await this.flush().unwrapOr(undefined)
    this.region.close()
    await this.local.close()
  }
}

/** Opens the database, loads the region from it and projects the region into it; a database whose region cannot load is closed. */
export function openRegion<T extends RegionSpace>(
  options: RegionSpaceOptions,
  build: (region: RegionDoc, local: LocalDb) => T,
): ResultAsync<T, DataError> {
  return options.openLocal().andThen((local) =>
    RegionDoc.open(local, options.ref)
      .map((region) => build(region, local))
      .orElse((error) => ResultAsync.fromSafePromise(local.close()).andThen(() => errAsync(error))),
  )
}

/** Opens a region's database on this device, as the identity's space does for its private region. */
export function openRegionSpace(options: RegionSpaceOptions): ResultAsync<RegionSpace, DataError> {
  return openRegion(options, (region, local) => new OpenRegion(region, local, options))
}
