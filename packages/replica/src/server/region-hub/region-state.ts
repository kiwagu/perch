import type { LoroDoc } from 'loro-crdt'

import type { RegionRef } from '../../region-doc'
import type { RegionDatabase } from '../region-databases'
import type { RegionLog } from '../region-log'

import type { Subscription } from './subscription'

/** A region's log and its authoritative document, and the hold on the database that keeps them. */
export interface Loaded {
  readonly log: RegionLog
  readonly doc: LoroDoc
  readonly database: RegionDatabase
}

/**
 * What the hub keeps of one region, from its first subscription or write until it unloads the
 * region or retires it.
 */
export interface RegionState {
  readonly ref: RegionRef
  /** Devices whose subscription was answered: each receives the batches the others push. */
  readonly subscribers: Map<string, Subscription>
  /** Devices whose subscription waits in the queue for its answer. */
  readonly joining: Map<string, Subscription>
  /** How many writes of the server's own are asked of the region and not settled yet. */
  writes: number
  /** Settles once the work asked of the region so far has; the next work waits for it. */
  queue: Promise<void>
  /** The region's log and document, once the first subscription has loaded them. */
  loaded: Loaded | undefined
  /** Cancels the unload scheduled when the last device left. */
  unload: (() => void) | undefined
}
