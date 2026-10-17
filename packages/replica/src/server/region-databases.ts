import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'

import type { RegionRef } from '../region-doc'

/** A hold on the database that keeps a region's log; the hub releases each hold once. */
export interface RegionDatabase {
  readonly local: LocalDb
  release(): void
}

/** Where the hub keeps each region's log and projection: the port the gateway implements. */
export interface RegionDatabases {
  acquire(region: RegionRef): ResultAsync<RegionDatabase, DataError>
}

/** Every region in one database, which nobody but its owner closes: releasing a hold does nothing. */
export function singleDatabase(local: LocalDb): RegionDatabases {
  return { acquire: () => okAsync({ local, release: () => {} }) }
}
