import type { LoroEventBatch, LoroMap } from 'loro-crdt'
import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb, publishChange, recordId } from '@workspace/data'

import { splitRecordKey } from './keys'
import type { RegionDoc } from './region-doc'
import { fieldOf, type ReplicaSchema } from './schema'
import deleteStatement from './surql/delete.surql'
import projectedKeysStatement from './surql/projected-keys.surql'
import upsertStatement from './surql/upsert.surql'

export interface ProjectorOptions {
  /** Hears about a record the moment its projection first fails; `flush` reports it too until it succeeds. */
  readonly onError: (error: DataError) => void
}

/** The record keys a batch of document events touched. */
function touchedKeys(batch: LoroEventBatch): Set<string> {
  const keys = new Set<string>()

  for (const event of batch.events) {
    if (event.path[0] !== 'records') {
      continue
    }

    if (event.path.length === 1 && event.diff.type === 'map') {
      for (const key of Object.keys(event.diff.updated)) {
        keys.add(key)
      }
    } else if (typeof event.path[1] === 'string') {
      keys.add(event.path[1])
    }
  }

  return keys
}

/**
 * Keeps the local database a materialized view of a region document. Every
 * local commit and every import is projected as an UPSERT of the whole record or
 * a DELETE, and the written tables are announced so watched shapes rerun.
 * Time-travel checkouts are not projected. Each write also records, in the same
 * transaction, that the region projected the record; on start the projector
 * reconciles that record with the document, so a deletion that failed before a
 * reload is still carried out. A failed record is retried by every `flush`.
 */
export class Projector {
  #queue: Promise<void> = Promise.resolve()
  readonly #failed = new Set<string>()

  constructor(
    private readonly region: RegionDoc,
    private readonly local: LocalDb,
    private readonly schema: ReplicaSchema,
    private readonly options: ProjectorOptions,
  ) {}

  start(): () => void {
    this.#queue = this.#queue.then(() => this.#reconcile())

    return this.region.doc.subscribe((batch) => {
      if (batch.by !== 'checkout') {
        this.#enqueue(touchedKeys(batch))
      }
    })
  }

  /** Resolves once every event observed so far is projected, retrying failed records; reports those still failing. */
  flush(): ResultAsync<void, DataError> {
    const settle = async (): Promise<void> => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      await this.#queue

      if (this.#failed.size > 0) {
        this.#enqueue(new Set(this.#failed))
        await this.#queue
      }
    }

    return ResultAsync.fromSafePromise(settle()).andThen(() =>
      this.#failed.size > 0
        ? errAsync(
            dataError('data:WRITE_FAILED', `could not project ${[...this.#failed].join(', ')}`),
          )
        : okAsync(undefined),
    )
  }

  /** Projects every record the document holds, and deletes those the region projected earlier but no longer holds. */
  async #reconcile(): Promise<void> {
    const held = new Set(this.region.records().keys() as string[])
    const stale: string[] = []

    try {
      const [projected] = (await this.local.db.query(projectedKeysStatement, {
        region: this.region.ref.id,
      })) as [string[]]

      stale.push(...projected.filter((key) => !held.has(key)))
    } catch (cause) {
      this.options.onError(
        dataError(
          'data:QUERY_FAILED',
          `could not read what ${this.region.ref.id} projected`,
          cause,
        ),
      )
    }

    await this.#project(new Set([...held, ...stale]))
  }

  #enqueue(keys: ReadonlySet<string>): void {
    if (keys.size === 0) {
      return
    }

    this.#queue = this.#queue.then(() => this.#project(keys))
  }

  async #project(keys: ReadonlySet<string>): Promise<void> {
    const tables = new Set<string>()

    for (const recordKeyValue of keys) {
      const parts = splitRecordKey(recordKeyValue)

      if (!parts) {
        continue
      }

      try {
        await this.#projectOne(recordKeyValue, parts.table, parts.key)
        this.#failed.delete(recordKeyValue)
        tables.add(parts.table)
      } catch (cause) {
        if (!this.#failed.has(recordKeyValue)) {
          this.#failed.add(recordKeyValue)
          this.options.onError(
            dataError('data:WRITE_FAILED', `could not project ${recordKeyValue}`, cause),
          )
        }
      }
    }

    if (tables.size > 0) {
      publishChange(this.local, [...tables], 'projector')
    }
  }

  async #projectOne(recordKeyValue: string, table: string, key: string): Promise<void> {
    const record = this.region.records().get(recordKeyValue) as LoroMap | undefined

    const region = this.region.ref.id

    if (!record) {
      await this.local.db.query(deleteStatement, { table, key, region, entry: recordKeyValue })

      return
    }

    const data = Object.fromEntries(
      Object.entries(record.toJSON() as Record<string, unknown>).map(([field, value]) => [
        field,
        this.#toColumn(table, field, value),
      ]),
    )

    await this.local.db.query(upsertStatement, { table, key, data, region, entry: recordKeyValue })
  }

  /** References stored as `table:key` become record ids, ISO strings of datetime fields become dates. */
  #toColumn(table: string, field: string, value: unknown): unknown {
    const kind = fieldOf(this.schema, table, field)

    if (kind?.kind === 'record' && typeof value === 'string') {
      const colon = value.indexOf(':')

      return recordId(value.slice(0, colon), value.slice(colon + 1))
    }

    if (kind?.kind === 'datetime' && typeof value === 'string') {
      return new Date(value)
    }

    return value
  }
}
