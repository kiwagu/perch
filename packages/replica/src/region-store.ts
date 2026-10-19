import { errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import {
  type DataError,
  type DataErrorCode,
  dataError,
  fromDriverValue,
  type LocalDb,
  recordId,
} from '@workspace/data'

import { messageOf } from './failure'
import localTailStatement from './surql/local-tail.surql'
import outboxAckStatement from './surql/outbox-ack.surql'
import outboxReadStatement from './surql/outbox-read.surql'
import appendStatement from './surql/replica-append.surql'
import cursorStatement from './surql/replica-cursor.surql'
import importStatement from './surql/replica-import.surql'
import saveSnapshotStatement from './surql/replica-save-snapshot.surql'

/** A local update not yet acknowledged by a server, under its number in the update log. */
export interface OutboxRow {
  /** The row's own key in the outbox, opaque: acknowledging the row deletes exactly it. */
  readonly id: string
  readonly seq: number
  readonly bytes: Uint8Array
}

/** A row of the update log as the driver returns it: bytes arrive as an ArrayBuffer. */
export interface StoredRow {
  readonly seq: number
  readonly bytes: ArrayBuffer
}

/** A row of the outbox as the driver returns it, with its record id. */
interface StoredOutboxRow extends StoredRow {
  readonly id: unknown
}

const OUTBOX = '_replica_outbox'

function toRow(row: StoredOutboxRow): OutboxRow {
  return { id: String(fromDriverValue(row.id)), seq: row.seq, bytes: new Uint8Array(row.bytes) }
}

/** How SurrealDB words a row under a number another writer on the database took first. */
const NUMBER_TAKEN = /Database index `replica_(?:update|outbox)_seq` already contains /

/** How many times in a row a write that lost its number to another writer is sent. */
const NUMBER_ATTEMPTS = 5

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
export class RegionStore {
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
    ).map(([rows]) => (rows as StoredOutboxRow[]).map(toRow))
  }

  acknowledge(rows: readonly OutboxRow[]): ResultAsync<void, DataError> {
    if (rows.length === 0) {
      return okAsync(undefined)
    }

    return this.#query(
      outboxAckStatement,
      { ids: rows.map((row) => recordId(OUTBOX, row.id)) },
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

  #query(
    statement: string,
    vars: Record<string, unknown>,
    code: DataErrorCode,
    message: string,
  ): ResultAsync<unknown[], DataError> {
    return ResultAsync.fromPromise(this.#send(statement, vars), (cause) =>
      dataError(code, message, cause),
    )
  }

  /**
   * Sends one statement or one transaction of this store. Tabs on one database write the
   * same head and cursor rows, so the database may refuse one of two concurrent
   * transactions as a conflict; each of these is safe to replay, and the driver retries it.
   * Tabs of a browser each run an engine of their own on the shared database, and two
   * engines may both take the next number: the log's unique number refuses the later write,
   * which is sent again at once and takes the number after.
   */
  async #send(statement: string, vars: Record<string, unknown>): Promise<unknown[]> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return (await this.local.db.query(statement, vars).retry()) as unknown[]
      } catch (cause) {
        if (attempt >= NUMBER_ATTEMPTS || !NUMBER_TAKEN.test(messageOf(cause))) {
          throw cause
        }
      }
    }
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
        results = await this.#send(appendStatement, { region: this.region, bytes: next })
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
