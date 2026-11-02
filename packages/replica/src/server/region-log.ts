import { LoroDoc, VersionVector } from 'loro-crdt'
import { err, errAsync, ok, okAsync, Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'

import { messageOf } from '../failure'
import type { CompactionOutcome } from '../protocol'

import { acceptRefusal } from './accept-refusal'
import type { BatchWriter } from './batch-writer'
import { SERVER_PEER } from './server-peer'
import acceptStatement from './surql/server-accept.surql'
import compactStatement from './surql/server-compact.surql'
import headStatement from './surql/server-head.surql'
import loadStatement from './surql/server-load.surql'
import rowVersionStatement from './surql/server-row-version.surql'

/** A record a batch writes: its column values in `table` under `key`. */
export interface ProjectedRow {
  readonly table: string
  readonly key: string
  /** The record's key in the region document, `<table>/<key>`. */
  readonly entry: string
  readonly data: Readonly<Record<string, unknown>>
}

/** A record a batch deletes from its table. */
export interface DeletedRow {
  readonly table: string
  readonly key: string
  /** The record's key in the region document, `<table>/<key>`. */
  readonly entry: string
}

/** One batch to accept: its projection, its update bytes and the document version right after it. */
export interface AcceptPlan {
  readonly upserts: readonly ProjectedRow[]
  readonly deletes: readonly DeletedRow[]
  readonly bytes: Uint8Array
  readonly version: Uint8Array
}

/** The region's head row; missing until its first batch. */
interface HeadRow {
  readonly head: number
  readonly covers: number
}

/** A row of the update log as the driver returns it: bytes arrive as an ArrayBuffer. */
interface StoredRow {
  readonly seq: number
  readonly bytes: ArrayBuffer
}

/** What the compaction transaction throws when the stored head row refuses the proposal. */
const COMPACTION_REFUSALS: ReadonlyArray<readonly [thrown: string, CompactionOutcome]> = [
  ['compaction:beyond-head', 'beyond-head'],
  ['compaction:stale', 'stale'],
]

/** The outcome a refused compaction stands for; SurrealDB reports a THROW as `An error occurred: <text>`. */
function refusalOf(cause: unknown): CompactionOutcome | undefined {
  const message = messageOf(cause)

  return COMPACTION_REFUSALS.find(([thrown]) => message.endsWith(thrown))?.[1]
}

/**
 * The server's log of one region. Each accepted batch is stored with its projection in one
 * transaction, under the next number of the region's head row, so the log has no gaps and
 * holds only batches whose projection the schema accepted, each Loro peer writing as one
 * identity, the one whose batch it first came with, but the server's peer, which only the
 * server's own changes bring. Several processes may hold a log
 * of the same region: the database issues the numbers, and a transaction that conflicts with
 * another process's is replayed. Within a process, the accepts and compactions of one log run
 * one at a time. A compaction replaces the rows up to a point with a snapshot of the server's
 * own document as it was after the row at that point, once a device proposed a snapshot of
 * that same version; the proposed bytes themselves are never stored.
 */
export class RegionLog {
  #queue: Promise<unknown> = Promise.resolve()
  #head: number
  #covers: number

  private constructor(
    private readonly local: LocalDb,
    private readonly region: string,
    state: HeadRow | undefined,
  ) {
    this.#head = state?.head ?? 0
    this.#covers = state?.covers ?? 0
  }

  /** Reads the region's head row, then builds its document from the snapshot and the rows after it. */
  static load(
    local: LocalDb,
    region: string,
  ): ResultAsync<{ readonly log: RegionLog; readonly doc: LoroDoc }, DataError> {
    const load = async () => {
      // The head is read first, so the rows read after it hold at least every batch up to it.
      const [state] = await local.db.query<[HeadRow | undefined]>(headStatement, { region })
      // BEGIN yields a result of its own, before the snapshot's and the rows'.
      const [, snapshots, rows] = await local.db.query<[unknown, ArrayBuffer[], StoredRow[]]>(
        loadStatement,
        { region },
      )
      const doc = new LoroDoc()
      const batch = [...snapshots, ...rows.map((row) => row.bytes)]

      if (batch.length > 0) {
        doc.importBatch(batch.map((bytes) => new Uint8Array(bytes)))
      }

      return { log: new RegionLog(local, region, state), doc }
    }

    return ResultAsync.fromPromise(load(), (cause) =>
      dataError('data:OPEN_FAILED', `could not load the log of region ${region}`, cause),
    )
  }

  /** The number of the last batch this log accepted or loaded. */
  head(): number {
    return this.#head
  }

  /** The number of the last batch the region's snapshot holds. */
  covers(): number {
    return this.#covers
  }

  /**
   * Writes the batch's projection and its log row in one transaction; resolves to the batch's
   * seq. A record that belongs to another region (it exists without this region's marker, or a
   * deletion names one this region never projected) refuses the batch with a
   * `data:WRITE_REJECTED` whose message starts with `ownership`. A device's batch that brings
   * changes of the server's peer, or of a peer another identity's batch was accepted under,
   * refuses with a `data:WRITE_REJECTED` whose message starts with `peer`; otherwise each peer it
   * brings is bound to `writer.identity` in the same transaction. The server's own change
   * (`writer` is `'server'`) binds no peer: its peer is bound to no identity.
   */
  accept(plan: AcceptPlan, writer: BatchWriter | 'server'): ResultAsync<number, DataError> {
    const { region } = this

    if (writer !== 'server' && writer.peers.includes(SERVER_PEER)) {
      return errAsync(
        dataError('data:WRITE_REJECTED', `peer: ${SERVER_PEER} is the server's own in ${region}`),
      )
    }

    const vars = {
      region,
      identity: writer === 'server' ? null : writer.identity,
      peers: writer === 'server' ? [] : writer.peers,
      upserts: plan.upserts,
      deletes: plan.deletes,
      bytes: plan.bytes,
      version: plan.version,
    }

    return this.#serialize(() =>
      this.#transact(acceptStatement, vars)
        .mapErr((cause) => acceptRefusal(region, cause))
        .map((results) => {
          // Every statement of the transaction yields a result: RETURN's is the one before COMMIT's.
          this.#head = Number(results.at(-2))

          return this.#head
        }),
    )
  }

  /**
   * Replaces log rows up to `covers` with a snapshot when the proposal is valid. A device's
   * `proposal` only asks: a version vector names peers and counters, not what their operations
   * did, so a device reusing a peer id could match it with other contents. The proposal is
   * checked against the version stored with row `covers`, and the snapshot stored is the one
   * `snapshotOf` exports for that version from the server's own document.
   */
  compact(
    covers: number,
    proposal: Uint8Array,
    snapshotOf: (version: VersionVector) => Uint8Array,
  ): ResultAsync<CompactionOutcome, DataError> {
    return this.#serialize((): ResultAsync<CompactionOutcome, DataError> => {
      if (covers > this.#head) {
        return okAsync('beyond-head')
      }

      if (covers <= this.#covers) {
        return okAsync('stale')
      }

      return this.#proposalVersion(proposal).asyncAndThen((version) =>
        this.#rowVersion(covers).andThen((stored) =>
          stored?.compare(version) === 0
            ? this.#ownSnapshot(snapshotOf, stored).asyncAndThen((snapshot) =>
                this.#replace(covers, snapshot, stored),
              )
            : okAsync<CompactionOutcome, DataError>('version-mismatch'),
        ),
      )
    })
  }

  /**
   * The version of the document a proposal holds. A shallow one is refused: the region would
   * be loaded from such a snapshot, and a document without the earlier history refuses an
   * update that a client made offline on top of a version before it.
   */
  #proposalVersion(snapshot: Uint8Array): Result<VersionVector, DataError> {
    return Result.fromThrowable(
      () => {
        const doc = new LoroDoc()

        doc.import(snapshot)

        return doc
      },
      (cause) =>
        dataError('data:WRITE_REJECTED', `a snapshot of ${this.region} does not decode`, cause),
    )().andThen((doc) =>
      doc.isShallow()
        ? err(
            dataError(
              'data:WRITE_REJECTED',
              `a snapshot of ${this.region} is shallow and lacks the region's history`,
            ),
          )
        : ok(doc.version()),
    )
  }

  /** The server's own snapshot of the region at `version`; a failure to export it is the server's. */
  #ownSnapshot(
    snapshotOf: (version: VersionVector) => Uint8Array,
    version: VersionVector,
  ): Result<Uint8Array, DataError> {
    return Result.fromThrowable(
      () => snapshotOf(version),
      (cause) =>
        dataError('data:WRITE_FAILED', `could not export a snapshot of ${this.region}`, cause),
    )()
  }

  /** The document version stored with the log row `seq`; undefined when the row is gone. */
  #rowVersion(seq: number): ResultAsync<VersionVector | undefined, DataError> {
    const message = `could not read the version of row ${seq} of ${this.region}`

    return ResultAsync.fromPromise(
      this.local.db.query<[(ArrayBuffer | undefined)[]]>(rowVersionStatement, {
        region: this.region,
        seq,
      }),
      (cause) => dataError('data:QUERY_FAILED', message, cause),
    ).andThen(([[stored]]) =>
      Result.fromThrowable(
        () => (stored ? VersionVector.decode(new Uint8Array(stored)) : undefined),
        (cause) => dataError('data:QUERY_FAILED', message, cause),
      )(),
    )
  }

  /** Stores the snapshot in place of the rows up to `covers`, unless the stored head row refuses it. */
  #replace(
    covers: number,
    snapshot: Uint8Array,
    version: VersionVector,
  ): ResultAsync<CompactionOutcome, DataError> {
    return this.#transact(compactStatement, {
      region: this.region,
      covers,
      bytes: snapshot,
      version: version.encode(),
    })
      .map((): CompactionOutcome => {
        this.#covers = covers

        return 'accepted'
      })
      .orElse((cause) => {
        // The stored head row is the authority: another process may have compacted since this log looked.
        const refusal = refusalOf(cause)

        return refusal
          ? ok(refusal)
          : err(
              dataError('data:WRITE_FAILED', `could not compact the log of ${this.region}`, cause),
            )
      })
  }

  /**
   * Runs one transaction of this log. Processes holding a log of the same region write the
   * same head row, so the database may refuse one of two concurrent transactions as a
   * conflict; each transaction here is safe to replay, and the driver retries it.
   */
  #transact(statement: string, vars: Record<string, unknown>): ResultAsync<unknown[], unknown> {
    return ResultAsync.fromPromise(
      this.local.db.query(statement, vars).retry() as PromiseLike<unknown[]>,
      (cause) => cause,
    )
  }

  /** Runs `work` once every accept and compaction asked of this log before it has settled. */
  #serialize<T>(work: () => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    const run = this.#queue.then(() => work())

    // The caller hears of a failure through `run`; the next call waits only for it to settle.
    this.#queue = run.catch(() => undefined)

    return new ResultAsync(run)
  }
}
