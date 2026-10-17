import {
  decodeImportBlobMeta,
  type ImportStatus,
  LoroDoc,
  type LoroMap,
  type PeerID,
} from 'loro-crdt'
import { errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import {
  type DataError,
  type DataErrorCode,
  dataError,
  type LocalDb,
  type Region,
} from '@workspace/data'

import localTailStatement from './surql/local-tail.surql'
import outboxAckStatement from './surql/outbox-ack.surql'
import outboxReadStatement from './surql/outbox-read.surql'
import appendStatement from './surql/replica-append.surql'
import cursorStatement from './surql/replica-cursor.surql'
import importStatement from './surql/replica-import.surql'
import loadStatement from './surql/replica-load.surql'
import saveSnapshotStatement from './surql/replica-save-snapshot.surql'

export interface RegionRef {
  readonly kind: Region
  /** The document id, e.g. `identity:<identity id>` for a private region. */
  readonly id: string
}

export interface OpenRegionOptions {
  readonly peerId?: bigint
}

/** A local update not yet acknowledged by a server, under its number in the update log. */
export interface OutboxRow {
  readonly seq: number
  readonly bytes: Uint8Array
}

/** Whether a server update was applied in full or part of it waits for history the document lacks. */
export interface ImportOutcome {
  readonly complete: boolean
}

/** A row of the update log or the outbox as the driver returns it: bytes arrive as an ArrayBuffer. */
interface StoredRow {
  readonly seq: number
  readonly bytes: ArrayBuffer
}

function toRow(row: StoredRow): OutboxRow {
  return { seq: row.seq, bytes: new Uint8Array(row.bytes) }
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
 * commit order, under the sequence number the database issues, so documents of
 * several tabs on one database never share a number. A failed append stays first
 * in line and is retried before any later update, so the log never has a gap; the
 * durable watermark moves only after a write succeeded. A separate watermark marks
 * how far this document has read the log; it moves only when the log is read, never
 * on this document's own writes, since another tab may hold a lower number. A compaction
 * drops only the rows up to it.
 */
class RegionStore {
  readonly #pending: Uint8Array[] = []
  #draining: Promise<void> | undefined
  #failure: DataError | undefined
  #persistedSeq: number
  #seenSeq: number

  constructor(
    private readonly local: LocalDb,
    private readonly region: string,
    loadedSeq: number,
  ) {
    this.#persistedSeq = loadedSeq
    this.#seenSeq = loadedSeq
  }

  get persistedSeq(): number {
    return this.#persistedSeq
  }

  append(bytes: Uint8Array): void {
    this.#pending.push(bytes)
    void this.#drain()
  }

  /** Resolves once every update so far is durable, retrying a failed one first; reports one that still fails. */
  flush(): ResultAsync<void, DataError> {
    return ResultAsync.fromSafePromise(this.#drain()).andThen(() =>
      this.#failure ? errAsync(this.#failure) : okAsync(undefined),
    )
  }

  /**
   * Stores a snapshot in place of the log rows this document has read. The caller exports
   * it in the same synchronous step, so it holds every row up to the watermark read here.
   */
  saveSnapshot(bytes: Uint8Array, version: Uint8Array): ResultAsync<void, DataError> {
    return this.#query(
      saveSnapshotStatement,
      { region: this.region, bytes, version, covers: this.#seenSeq },
      'data:WRITE_FAILED',
      `could not compact region ${this.region}`,
    ).map(() => undefined)
  }

  /** Appends a server update to the update log, after every local update so far; the outbox does not take it. */
  appendRemote(bytes: Uint8Array): ResultAsync<void, DataError> {
    return this.flush()
      .andThen(() =>
        this.#query(
          importStatement,
          { region: this.region, bytes },
          'data:WRITE_FAILED',
          `could not persist a server update of ${this.region}`,
        ),
      )
      .map(() => undefined)
  }

  /** Moves the stored cursor to `pulled` unless it is already further. */
  writeCursor(pulled: number): ResultAsync<void, DataError> {
    return this.#query(
      cursorStatement,
      { region: this.region, pulled },
      'data:WRITE_FAILED',
      `could not move the cursor of ${this.region}`,
    ).map(() => undefined)
  }

  outbox(limit: number): ResultAsync<readonly OutboxRow[], DataError> {
    return this.#query(
      outboxReadStatement,
      { region: this.region, limit },
      'data:QUERY_FAILED',
      `could not read the outbox of ${this.region}`,
    ).map(([rows]) => (rows as StoredRow[]).map(toRow))
  }

  acknowledge(seq: number): ResultAsync<void, DataError> {
    return this.#query(
      outboxAckStatement,
      { region: this.region, seq },
      'data:WRITE_FAILED',
      `could not drop acknowledged updates of ${this.region}`,
    ).map(() => undefined)
  }

  /** Hands `apply` the log rows past what this document has read, then moves past them; resolves to how many. */
  catchUp(apply: (updates: Uint8Array[]) => void): ResultAsync<number, DataError> {
    const message = `could not catch up with the update log of ${this.region}`

    return this.#query(
      localTailStatement,
      { region: this.region, after: this.#seenSeq },
      'data:QUERY_FAILED',
      message,
    ).andThen(([tail]) => {
      const rows = tail as StoredRow[]
      const last = rows.at(-1)

      if (!last) {
        return ok(0)
      }

      return Result.fromThrowable(
        () => apply(rows.map((row) => new Uint8Array(row.bytes))),
        (cause) => dataError('data:QUERY_FAILED', message, cause),
      )().map(() => {
        this.#seenSeq = Math.max(this.#seenSeq, last.seq)

        return rows.length
      })
    })
  }

  /**
   * Runs one statement or one transaction of this store. Tabs on one database write the
   * same head and cursor rows, so the database may refuse one of two concurrent
   * transactions as a conflict; each of these is safe to replay, and the driver retries it.
   */
  #query(
    statement: string,
    vars: Record<string, unknown>,
    code: DataErrorCode,
    message: string,
  ): ResultAsync<unknown[], DataError> {
    return ResultAsync.fromPromise(
      this.local.db.query(statement, vars).retry() as PromiseLike<unknown[]>,
      (cause) => dataError(code, message, cause),
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
      let results: unknown[]

      try {
        // Replayed on a conflict with another tab's append, as in `#query`.
        results = await this.local.db
          .query(appendStatement, { region: this.region, bytes: next })
          .retry()
      } catch (cause) {
        this.#failure = dataError(
          'data:WRITE_FAILED',
          `could not persist an update of ${this.region}`,
          cause,
        )

        return
      }

      this.#pending.shift()
      // Every statement of the transaction yields a result: RETURN's is the one before COMMIT's.
      this.#persistedSeq = Number(results.at(-2))
      this.#failure = undefined
    }
  }
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

  /** Drops outbox rows up to and including `seq` once the server acknowledged them. */
  acknowledge(seq: number): ResultAsync<void, DataError> {
    return this.#store?.acknowledge(seq) ?? okAsync(undefined)
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
