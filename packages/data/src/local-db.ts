import { ResultAsync } from 'neverthrow'
import { type Engines, Surreal } from 'surrealdb'

import { type DataError, dataError } from './errors'
import appliedSchemaStatement from './surql/applied-schema.surql'
import rememberSchemaStatement from './surql/remember-schema.surql'
import type { LocalDb } from './types'

export interface OpenLocalDbOptions {
  /** Engines from `@workspace/data/engines/node` or `@workspace/data/engines/wasm`. */
  readonly engines: Engines
  readonly url: string
  readonly namespace: string
  readonly database: string
  /** The schema as SurrealQL text, read by the caller from the schema files. */
  readonly schema: string
  /**
   * A system user to connect as. An embedded database needs none; a server stand is
   * opened as one so the projector may write rows record users may not create. With a
   * `namespace` the user is one defined on that namespace, otherwise a root user.
   */
  readonly credentials?: {
    readonly username: string
    readonly password: string
    readonly namespace?: string
  }
}

/**
 * Connects to a local database and brings its schema up to date before anything
 * reads from it. A schema the database already applied is left alone: defining
 * the access method again would give it a new signing key and sign everyone out.
 */
export function openLocalDb(options: OpenLocalDbOptions): ResultAsync<LocalDb, DataError> {
  const db = new Surreal({ engines: options.engines })

  const open = async (): Promise<LocalDb> => {
    await db.connect(
      options.url,
      options.credentials ? { authentication: { ...options.credentials } } : undefined,
    )
    await db.use({ namespace: options.namespace, database: options.database })
    const [applied] = await db.query<[string | undefined]>(appliedSchemaStatement)

    if (applied !== options.schema) {
      await db.query(options.schema)
      await db.query(rememberSchemaStatement, { schema: options.schema })
    }

    return {
      db,
      changes: new EventTarget(),
      close: async () => {
        await db.close()
      },
    }
  }

  return ResultAsync.fromPromise(open(), (cause) => {
    void db.close()

    return dataError('data:OPEN_FAILED', `could not open ${options.url}`, cause)
  })
}
