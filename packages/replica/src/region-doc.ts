import { LoroDoc, type LoroMap } from 'loro-crdt'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb, type Region } from '@workspace/data'

import appendStatement from './surql/replica-append.surql'
import loadStatement from './surql/replica-load.surql'
import saveSnapshotStatement from './surql/replica-save-snapshot.surql'

export interface RegionRef {
  readonly kind: Region
  /** The document id, e.g. `user:<user id>` for a private region. */
  readonly id: string
}

export interface OpenRegionOptions {
  readonly peerId?: bigint
}

function randomPeerId(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8))

  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n)
}

function createDoc(peerId: bigint): LoroDoc {
  const doc = new LoroDoc()

  doc.setPeerId(peerId)
  doc.setRecordTimestamp(true)

  return doc
}

/**
 * Durable storage of a region document in the local database: every local
 * update is appended to the update log and the outbox in one transaction, in
 * commit order, under the sequence number it got when it was committed. A failed
 * append stays first in line and is retried before any later update, so the log
 * never has a gap; the durable watermark moves only after a write succeeded.
 */
class RegionStore {
  readonly #pending: Array<{ readonly seq: number; readonly bytes: Uint8Array }> = []
  #draining: Promise<void> | undefined
  #failure: DataError | undefined
  #nextSeq: number
  #persistedSeq: number

  constructor(
    private readonly local: LocalDb,
    private readonly region: string,
    lastSeq: number,
  ) {
    this.#nextSeq = lastSeq + 1
    this.#persistedSeq = lastSeq
  }

  get persistedSeq(): number {
    return this.#persistedSeq
  }

  append(bytes: Uint8Array): void {
    this.#pending.push({ seq: this.#nextSeq++, bytes })
    void this.#drain()
  }

  /** Resolves once every update so far is durable, retrying a failed one first; reports one that still fails. */
  flush(): ResultAsync<void, DataError> {
    return ResultAsync.fromSafePromise(this.#drain()).andThen(() =>
      this.#failure ? errAsync(this.#failure) : okAsync(undefined),
    )
  }

  saveSnapshot(bytes: Uint8Array, version: Uint8Array): ResultAsync<void, DataError> {
    return this.flush().andThen(() =>
      ResultAsync.fromPromise(
        this.local.db.query(saveSnapshotStatement, {
          region: this.region,
          bytes,
          version,
          covers: this.#persistedSeq,
        }) as PromiseLike<unknown>,
        (cause) => dataError('data:WRITE_FAILED', `could not compact region ${this.region}`, cause),
      ).map(() => undefined),
    )
  }

  #drain(): Promise<void> {
    this.#draining ??= this.#writePending().finally(() => {
      this.#draining = undefined
    })

    return this.#draining
  }

  async #writePending(): Promise<void> {
    for (let next = this.#pending[0]; next; next = this.#pending[0]) {
      try {
        await this.local.db.query(appendStatement, {
          region: this.region,
          seq: next.seq,
          bytes: next.bytes,
        })
      } catch (cause) {
        this.#failure = dataError(
          'data:WRITE_FAILED',
          `could not persist update ${next.seq} of ${this.region}`,
          cause,
        )

        return
      }

      this.#pending.shift()
      this.#persistedSeq = next.seq
      this.#failure = undefined
    }
  }
}

/** One region's CRDT document: the source of truth for the replicated data of that region. */
export class RegionDoc {
  readonly #store: RegionStore | undefined
  readonly #unsubscribe: () => void

  private constructor(
    readonly ref: RegionRef,
    readonly doc: LoroDoc,
    store?: RegionStore,
  ) {
    this.#store = store
    this.#unsubscribe = store ? doc.subscribeLocalUpdates((bytes) => store.append(bytes)) : () => {}
  }

  /** A document without persistence, for tests and transient use. */
  static inMemory(kind: Region, id: string = kind, peerId: bigint = randomPeerId()): RegionDoc {
    return new RegionDoc({ kind, id }, createDoc(peerId))
  }

  /** Loads the region from the local database and persists every later local update there. */
  static open(
    local: LocalDb,
    ref: RegionRef,
    options: OpenRegionOptions = {},
  ): ResultAsync<RegionDoc, DataError> {
    const load = async (): Promise<RegionDoc> => {
      const [snapshots, updates, outbox] = (await local.db.query(loadStatement, {
        region: ref.id,
      })) as [Uint8Array[], Array<{ seq: number; bytes: Uint8Array }>, number[]]
      const doc = createDoc(options.peerId ?? randomPeerId())
      const batch = [...snapshots, ...updates.map((update) => update.bytes)]

      if (batch.length > 0) {
        doc.importBatch(batch)
      }

      const lastSeq = Math.max(0, ...updates.map((update) => update.seq), ...outbox)
      const store = new RegionStore(local, ref.id, lastSeq)

      return new RegionDoc(ref, doc, store)
    }

    return ResultAsync.fromPromise(load(), (cause) =>
      dataError('data:OPEN_FAILED', `could not open region ${ref.id}`, cause),
    )
  }

  get kind(): Region {
    return this.ref.kind
  }

  records(): LoroMap {
    return this.doc.getMap('records')
  }

  /** The plain value of one record, or undefined when the region does not hold it. */
  recordJson(key: string): Readonly<Record<string, unknown>> | undefined {
    const value = this.records().get(key) as LoroMap | undefined

    return value ? (value.toJSON() as Record<string, unknown>) : undefined
  }

  /** The sequence number of the last local update known to be durable. */
  persistedSeq(): number {
    return this.#store?.persistedSeq ?? 0
  }

  /** Resolves once every local update so far is durable; reports an update that could not be made durable. */
  flush(): ResultAsync<void, DataError> {
    return this.#store?.flush() ?? okAsync(undefined)
  }

  /** Replaces the update log with one full snapshot of the document. */
  compact(): ResultAsync<void, DataError> {
    return (
      this.#store?.saveSnapshot(
        this.doc.export({ mode: 'snapshot' }),
        this.doc.version().encode(),
      ) ?? okAsync(undefined)
    )
  }

  close(): void {
    this.#unsubscribe()
  }
}
