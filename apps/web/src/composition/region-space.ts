/**
 * One region's database on this device: the region document, loaded from the database and
 * projected into it, a runner over the database and the write path into the document. The
 * identity's own database holds its private region this way, and each organisation's database
 * its tenant region (`openTenantSpace`).
 */

import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import {
  type DataError,
  dataError,
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
  type RegionReplacement,
  type ReplicaSchema,
  replaceRegionDoc,
} from '@workspace/replica'

export interface RegionSpace {
  /** The region's document: another one once `replace` swapped it. */
  readonly region: RegionDoc
  readonly runner: ShapeRunnerPort
  /** The same object for the space's life: it writes into the current document. */
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
  /**
   * Replaces the region's document (`replaceRegionDoc`) while no write runs into it: a write
   * meanwhile is refused (`data:WRITE_REJECTED`, the region is being reloaded). The projector
   * starts over on the new document, so the database shows what it holds, and the write path
   * writes into it. Replacements run one after the other; when `current` was replaced already
   * the current document is the answer. When the replacement fails the old document stays,
   * projected and written as before.
   */
  replace(current: RegionDoc, how: RegionReplacement): ResultAsync<RegionDoc, DataError>
  /** Whether another tab reset the region since this space's document opened. */
  stale(): ResultAsync<boolean, DataError>
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
  #region: RegionDoc
  #projector: Projector
  #stopProjecting: () => void
  #writes: LoroWritePath
  #reloading = false
  /** The replacement under way, if any; the next one waits for it. It never rejects. */
  #replacing: Promise<unknown> = Promise.resolve()
  #closing: Promise<void> | undefined

  constructor(
    region: RegionDoc,
    private readonly local: LocalDb,
    private readonly options: RegionSpaceOptions,
  ) {
    this.#region = region
    this.#projector = new Projector(region, local, options.schema, { onError: options.onError })
    this.#stopProjecting = this.#projector.start()
    this.#writes = new LoroWritePath(region, options.schema)
    this.runner = new ShapeRunner(local)
    this.writePath = {
      run: (command, params, meta) =>
        this.#reloading
          ? errAsync(dataError('data:WRITE_REJECTED', `${this.#region.ref.id} is being reloaded`))
          : this.#writes.run(command, params, meta),
    }
  }

  get region(): RegionDoc {
    return this.#region
  }

  flush(): ResultAsync<void, DataError> {
    return this.#region.flush().andThen(() => this.#projector.flush())
  }

  unsent(): ResultAsync<boolean, DataError> {
    const region = this.#region

    // A failed append was reported to the write that made it; its change is unsent all the same.
    return region
      .flush()
      .map(() => true)
      .orElse(() => okAsync(false))
      .andThen((durable) =>
        durable ? region.outbox(1).map((rows) => rows.length > 0) : okAsync(true),
      )
  }

  catchUp(): ResultAsync<number, DataError> {
    return this.#region.catchUpLocal()
  }

  replace(current: RegionDoc, how: RegionReplacement): ResultAsync<RegionDoc, DataError> {
    const run = this.#replacing.then(() =>
      current === this.#region ? this.#swap(how) : okAsync(this.#region),
    )

    // The caller hears of a failure through `run`; the next replacement waits only for it to settle.
    this.#replacing = run.catch(() => undefined)

    return new ResultAsync(run)
  }

  stale(): ResultAsync<boolean, DataError> {
    return this.#region.stale()
  }

  close(): Promise<void> {
    this.#closing ??= this.#shutDown()

    return this.#closing
  }

  async destroy(): Promise<void> {
    await this.close()
    await this.local.destroy()
  }

  /**
   * Writes are refused and the projector stops and finishes what it queued, so nothing of the
   * old document lands in the database after the new projector reconciled it.
   */
  #swap(how: RegionReplacement): ResultAsync<RegionDoc, DataError> {
    const old = this.#region

    if (this.#closing) {
      return errAsync(dataError('data:OPEN_FAILED', `${old.ref.id} is closed`))
    }

    this.#reloading = true
    this.#stopProjecting()

    return (
      this.#projector
        .flush()
        .orElse(() => okAsync(undefined))
        .andThen(() => replaceRegionDoc(this.local, old, how))
        .andTee((next) => {
          this.#region = next
          this.#writes = new LoroWritePath(next, this.options.schema)
        })
        // A failed replacement keeps the old document: it is projected again as it was.
        .andTee(() => this.#resume())
        .orTee(() => this.#resume())
    )
  }

  /** Projects the current document from scratch and lets writes in again. */
  #resume(): void {
    this.#projector = new Projector(this.#region, this.local, this.options.schema, {
      onError: this.options.onError,
    })
    this.#stopProjecting = this.#projector.start()
    this.#reloading = false
  }

  async #shutDown(): Promise<void> {
    await this.#replacing
    this.#stopProjecting()
    // The last writes still persist and project before the database closes; a failure there
    // was already reported to the write that made it, or by the projector.
    await this.flush().unwrapOr(undefined)
    this.#region.close()
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
