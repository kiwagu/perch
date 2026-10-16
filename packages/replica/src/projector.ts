import type { LoroEventBatch, LoroMap } from 'loro-crdt'

import { type DataError, dataError, type LocalDb, publishChange, recordId } from '@workspace/data'

import { splitRecordKey } from './keys'
import type { RegionDoc } from './region-doc'
import { fieldOf, type ReplicaSchema } from './schema'
import deleteStatement from './surql/delete.surql'
import upsertStatement from './surql/upsert.surql'

export interface ProjectorOptions {
  /** Receives every failed projection; a failure must not pass silently. */
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
 * Time-travel checkouts are not projected.
 */
export class Projector {
  #queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly region: RegionDoc,
    private readonly local: LocalDb,
    private readonly schema: ReplicaSchema,
    private readonly options: ProjectorOptions,
  ) {}

  start(): () => void {
    this.#enqueue(new Set(this.region.records().keys() as string[]))

    return this.region.doc.subscribe((batch) => {
      if (batch.by !== 'checkout') {
        this.#enqueue(touchedKeys(batch))
      }
    })
  }

  /** Resolves once every event observed so far is projected. */
  async flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await this.#queue
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
        tables.add(parts.table)
      } catch (cause) {
        this.options.onError(
          dataError('data:COMMAND_FAILED', `could not project ${recordKeyValue}`, cause),
        )
      }
    }

    if (tables.size > 0) {
      publishChange(this.local, [...tables], 'projector')
    }
  }

  async #projectOne(recordKeyValue: string, table: string, key: string): Promise<void> {
    const record = this.region.records().get(recordKeyValue) as LoroMap | undefined

    if (!record) {
      await this.local.db.query(deleteStatement, { table, key })

      return
    }

    const data = Object.fromEntries(
      Object.entries(record.toJSON() as Record<string, unknown>).map(([field, value]) => [
        field,
        this.#toColumn(table, field, value),
      ]),
    )

    await this.local.db.query(upsertStatement, { table, key, data })
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
