import type { Surreal } from 'surrealdb'

import type { ChangeSpec } from '@workspace/kernel'

export type Region = 'private' | 'public' | 'org' | 'server'

/**
 * A read model compiled from a `*.shape.surql` file by the modeling stage. The
 * runner accepts only this object, never a query string, so every read is
 * declared in a `.surql` file and its tables are known statically.
 */
export interface Shape<Params, Result> {
  readonly id: string
  readonly kind: 'shape'
  readonly text: string
  readonly tables: readonly string[]
  readonly __params?: Params
  readonly __result?: Result
}

/** A write compiled from a `*.commands.surql` file: its SurrealQL and its replica operations. */
export interface Command<Params> {
  readonly id: string
  readonly kind: 'command'
  readonly text: string
  readonly tables: readonly string[]
  readonly region: Region
  readonly ops: readonly ChangeSpec[]
  readonly __params?: Params
}

export type ChangeOrigin = 'command' | 'projector' | 'sync' | 'external'

/** Announces that rows of these tables changed in the local database. */
export interface TableChange {
  readonly tables: readonly string[]
  readonly origin: ChangeOrigin
}

export interface LocalDb {
  readonly db: Surreal
  readonly changes: EventTarget
  close(): Promise<void>
}
