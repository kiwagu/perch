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

const INDEXED_DB = 'indxdb://'

/** The part of an IndexedDB delete request that deleting a store waits on. */
interface DeleteRequest {
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  readonly error: unknown
}

/** The part of the browser's `indexedDB` that deleting a store uses. */
interface StoreFactory {
  deleteDatabase(name: string): DeleteRequest
}

function isStoreFactory(value: unknown): value is StoreFactory {
  return (
    typeof value === 'object' &&
    value !== null &&
    'deleteDatabase' in value &&
    typeof value.deleteDatabase === 'function'
  )
}

/**
 * Deletes the browser's IndexedDB database `name`, which the engine named after the part of
 * its `indxdb://` address that follows the scheme. A delete that an open connection blocks
 * (the engine's worker still letting go of it, or another tab that has not closed its own
 * yet) is not refused: IndexedDB runs it once the last connection closes, and this waits.
 */
function deleteStore(name: string): Promise<void> {
  const factory: unknown = Reflect.get(globalThis, 'indexedDB')

  if (!isStoreFactory(factory)) {
    return Promise.reject(new Error(`IndexedDB is not available here, so ${name} stays`))
  }

  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

/** Deletes what a closed database stored, by the kind of its address. */
function deleteStored(url: string): Promise<void> {
  if (url.startsWith(INDEXED_DB)) {
    return deleteStore(url.slice(INDEXED_DB.length))
  }

  if (url.startsWith('mem://')) {
    return Promise.resolve()
  }

  return Promise.reject(
    new Error(`cannot delete the database at ${url}: only indxdb:// and mem://`),
  )
}

/**
 * Deletes what the database at `url` stored, without opening it: the browser's IndexedDB
 * database of an `indxdb://` address (one that is not there is no failure), nothing for a
 * `mem://` one. As `destroy` does once it closed a database; the database must not be open here.
 */
export function deleteLocalDb(url: string): ResultAsync<void, DataError> {
  return ResultAsync.fromPromise(deleteStored(url), (cause) =>
    dataError('data:WRITE_FAILED', `could not delete ${url}`, cause),
  )
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

    let closing: Promise<void> | undefined
    const close = (): Promise<void> => {
      closing ??= db.close().then(() => undefined)

      return closing
    }

    return {
      db,
      changes: new EventTarget(),
      close,
      destroy: async () => {
        await close()
        await deleteStored(options.url)
      },
    }
  }

  return ResultAsync.fromPromise(open(), (cause) => {
    void db.close()

    return dataError('data:OPEN_FAILED', `could not open ${options.url}`, cause)
  })
}
