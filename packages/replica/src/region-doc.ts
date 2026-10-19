import {
  decodeImportBlobMeta,
  type ImportStatus,
  LoroDoc,
  type LoroMap,
  type PeerID,
} from 'loro-crdt'
import { errAsync, okAsync, Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb, type Region } from '@workspace/data'

import { type OutboxRow, RegionStore, type StoredRow } from './region-store'
import loadStatement from './surql/replica-load.surql'

export interface RegionRef {
  readonly kind: Region
  /** The document id, e.g. `identity:<identity id>` for a private region. */
  readonly id: string
}

export interface OpenRegionOptions {
  readonly peerId?: bigint
}

export type { OutboxRow }

/** Whether a server update was applied in full or part of it waits for history the document lacks. */
export interface ImportOutcome {
  readonly complete: boolean
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

/** One region's CRDT document: the source of truth for the replicated data of that region. */
export class RegionDoc {
  readonly #store: RegionStore | undefined
  readonly #unsubscribe: () => void
  /** Per peer, the end of the furthest change an import left waiting for history this document lacks. */
  readonly #waiting = new Map<PeerID, number>()
  #pulled: number

  private constructor(
    readonly ref: RegionRef,
    readonly doc: LoroDoc,
    store?: RegionStore,
    pulled = 0,
  ) {
    this.#store = store
    this.#pulled = pulled
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
      const [snapshots, updates, cursor] = await local.db.query<
        [ArrayBuffer[], StoredRow[], number[]]
      >(loadStatement, { region: ref.id })
      const doc = createDoc(options.peerId ?? randomPeerId())
      const batch = [...snapshots, ...updates.map((update) => update.bytes)]
      const status =
        batch.length > 0 ? doc.importBatch(batch.map((bytes) => new Uint8Array(bytes))) : undefined
      const loadedSeq = Math.max(0, ...updates.map((update) => update.seq))
      const store = new RegionStore(local, ref.id, loadedSeq)
      const region = new RegionDoc(ref, doc, store, cursor[0] ?? 0)

      if (status) {
        region.#settle(status)
      }

      return region
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

  /** The container of one record the region holds. */
  recordMap(key: string): LoroMap {
    return this.records().get(key) as LoroMap
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

  /** How far this device has pulled the region from the server. */
  pulled(): number {
    return this.#pulled
  }

  /** Resolves once every local update so far is durable; reports an update that could not be made durable. */
  flush(): ResultAsync<void, DataError> {
    return this.#store?.flush() ?? okAsync(undefined)
  }

  /**
   * Persists a server update, imports it, then moves the cursor to `head` when nothing is
   * left pending. Bytes that do not decode as a Loro update are refused before they are
   * stored, since a stored row that cannot be imported would fail every later load.
   */
  importRemote(bytes: Uint8Array, head: number): ResultAsync<ImportOutcome, DataError> {
    const id = this.ref.id

    return Result.fromThrowable(
      () => decodeImportBlobMeta(bytes, true),
      (cause) =>
        dataError('data:WRITE_REJECTED', `a server update of ${id} does not decode`, cause),
    )()
      .asyncAndThen(() => this.#store?.appendRemote(bytes) ?? okAsync(undefined))
      .andThen(() =>
        Result.fromThrowable(
          () => this.doc.import(bytes),
          (cause) =>
            dataError('data:WRITE_FAILED', `could not import a server update of ${id}`, cause),
        )(),
      )
      .andThen(
        (status): ResultAsync<ImportOutcome, DataError> =>
          this.#settle(status)
            ? this.advanceCursor(head).map(() => ({ complete: true }))
            : okAsync({ complete: false }),
      )
  }

  /** Moves the cursor forward without new bytes: the server's head is this device's own acknowledged batch. */
  advanceCursor(head: number): ResultAsync<void, DataError> {
    return (this.#store?.writeCursor(head) ?? okAsync(undefined)).andTee(() => {
      this.#pulled = Math.max(this.#pulled, head)
    })
  }

  /** The oldest unacknowledged local updates, at most `limit` rows. */
  outbox(limit: number): ResultAsync<readonly OutboxRow[], DataError> {
    return this.#store?.outbox(limit) ?? okAsync([])
  }

  /** Drops exactly these outbox rows once the server acknowledged them. */
  acknowledge(rows: readonly OutboxRow[]): ResultAsync<void, DataError> {
    return this.#store?.acknowledge(rows) ?? okAsync(undefined)
  }

  /**
   * Imports update-log rows other tabs appended since this document last looked; resolves to
   * how many rows it read. The rows include this document's own, which change nothing. They
   * are imported one at a time: a batch that holds updates the document already has makes
   * Loro announce the change as a checkout, which a projector rightly does not follow.
   */
  catchUpLocal(): ResultAsync<number, DataError> {
    return (
      this.#store?.catchUp((updates) => {
        for (const update of updates) {
          this.#settle(this.doc.import(update))
        }
      }) ?? okAsync(0)
    )
  }

  /**
   * Imports outbox rows into this document, one at a time as `catchUpLocal` does, so a
   * projector sees each as an import; rows the document holds already change nothing. The
   * update log, the outbox and the watermarks stay as they are.
   */
  importLocal(rows: readonly OutboxRow[]): Result<void, DataError> {
    return Result.fromThrowable(
      () => {
        for (const row of rows) {
          this.#settle(this.doc.import(row.bytes))
        }
      },
      (cause) =>
        dataError('data:QUERY_FAILED', `could not import outbox rows of ${this.ref.id}`, cause),
    )()
  }

  /**
   * Replaces the update log with one full snapshot of the document, after making local
   * updates durable and importing what other tabs appended, so the rows it drops are in it.
   * Refuses while an imported update still waits for its history: a snapshot leaves such
   * updates out, so dropping their rows would lose them.
   */
  compact(): ResultAsync<void, DataError> {
    const store = this.#store

    if (!store) {
      return okAsync(undefined)
    }

    return store
      .flush()
      .andThen(() => this.catchUpLocal())
      .andThen(
        (): ResultAsync<void, DataError> =>
          this.#waiting.size > 0
            ? errAsync(
                dataError(
                  'data:WRITE_REJECTED',
                  `cannot compact ${this.ref.id} while imported updates still wait for their history`,
                ),
              )
            : store.saveSnapshot(
                this.doc.export({ mode: 'snapshot' }),
                this.doc.version().encode(),
              ),
      )
  }

  close(): void {
    this.#unsubscribe()
  }

  /**
   * Remembers what an import left waiting for missing history and forgets what has
   * arrived since; true when nothing waits. Loro reports pending changes per import,
   * so a later import that completes on its own says nothing about earlier gaps.
   */
  #settle(status: ImportStatus): boolean {
    for (const [peer, span] of status.pending ?? []) {
      this.#waiting.set(peer, Math.max(this.#waiting.get(peer) ?? 0, span.end))
    }

    const known = this.doc.oplogVersion()

    for (const [peer, end] of this.#waiting) {
      if ((known.get(peer) ?? 0) >= end) {
        this.#waiting.delete(peer)
      }
    }

    return this.#waiting.size === 0
  }
}
