import type { Surreal } from 'surrealdb'

import type { ChangeSpec } from '@workspace/kernel'

export type Region = 'private' | 'public' | 'org' | 'server'

/** A declared parameter: `$id: record<identity>` gives `{ name: 'id', type: 'record<identity>' }`. */
export interface ParamDecl {
  readonly name: string
  readonly type: string
}

/**
 * A read model compiled from a `*.shape.surql` file by the modeling stage. The
 * runner accepts only this object, never a query string, so every read is
 * declared in a `.surql` file and its tables are known statically.
 */
export interface Shape<Params, Result> {
  readonly id: string
  readonly kind: 'shape'
  readonly text: string
  readonly params: readonly ParamDecl[]
  readonly tables: readonly string[]
  readonly __params?: Params
  readonly __result?: Result
}

/** The outcome of validating a value: the parsed value, or the problems found. */
export type ValidationOutcome<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: ReadonlyArray<{ readonly message: string }> }

/**
 * A validator in the Standard Schema shape, which Zod and other libraries
 * implement; the data layer depends on the shape, not on a library.
 */
export interface ParamsSchema<Output> {
  readonly '~standard': {
    readonly validate: (
      value: unknown,
    ) => ValidationOutcome<Output> | Promise<ValidationOutcome<Output>>
  }
}

/** A write compiled from a `*.commands.surql` file: its SurrealQL and its replica operations. */
export interface Command<Params> {
  readonly id: string
  readonly kind: 'command'
  readonly text: string
  readonly params: readonly ParamDecl[]
  readonly tables: readonly string[]
  readonly region: Region
  readonly ops: readonly ChangeSpec[]
  /** Validates the parameters before the command runs. */
  readonly schema?: ParamsSchema<Params>
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
