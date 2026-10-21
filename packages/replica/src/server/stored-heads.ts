import { type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

import type { RegionRef } from '../region-doc'
import { regionRefOf } from '../region-ref'

import type { RegionDatabases } from './region-databases'
import headsStatement from './surql/server-heads.surql'

/** A region's head row as the database holds it. */
interface StoredHead {
  readonly region: string
  readonly head: number
}

/**
 * The heads the databases hold for regions not in memory, by region: one query per database
 * the port names, which is released once it answered. A region the hub does not know is not
 * asked.
 */
export function storedHeads(
  databases: RegionDatabases,
  regionIds: readonly string[],
): ResultAsync<ReadonlyMap<string, number>, DataError> {
  const groups = new Map<string, { readonly ref: RegionRef; readonly ids: string[] }>()

  for (const id of regionIds) {
    const ref = regionRefOf(id)

    if (ref) {
      const database = databases.databaseOf(ref)
      const group = groups.get(database) ?? { ref, ids: [] }

      group.ids.push(id)
      groups.set(database, group)
    }
  }

  return ResultAsync.combine(
    [...groups.values()].map(({ ref, ids }) => headsIn(databases, ref, ids)),
  ).map((lists) => new Map(lists.flat().map((row) => [row.region, row.head])))
}

/** The heads the database of `ref` holds for `regionIds`, all kept in that database. */
function headsIn(
  databases: RegionDatabases,
  ref: RegionRef,
  regionIds: readonly string[],
): ResultAsync<StoredHead[], DataError> {
  return databases.acquire(ref).andThen(({ local, release }) => {
    const read = async (): Promise<Result<StoredHead[], DataError>> => {
      try {
        return await ResultAsync.fromPromise(
          local.db.query<[StoredHead[]]>(headsStatement, { regions: regionIds }),
          (cause) => dataError('data:QUERY_FAILED', 'could not read the heads of regions', cause),
        ).map(([rows]) => rows)
      } finally {
        release()
      }
    }

    return new ResultAsync(read())
  })
}
