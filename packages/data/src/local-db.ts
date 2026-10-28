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
  /**
   * The key the schema's access methods sign their tokens with, given to the schema as
   * `$jwt_key`. A server's database is opened with one fixed key, so applying the schema
   * again leaves every token valid. Without one, each apply gives the access methods a key of
   * its own: right for a database nobody signs in to from outside (a device's replica, a test).
   */
  readonly signingKey?: string
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

/** A signing key for one apply only: 48 random bytes, base64url. */
function ephemeralKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(48))

  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * What a database remembers of the schema it applied: the text, and with a signing key a
 * digest of the key too, so a new key applies the schema again. Only compared, never run.
 */
async function markerOf(schema: string, signingKey: string | undefined): Promise<string> {
  return signingKey === undefined
    ? schema
    : `${schema}\n-- signing key ${await sha256Hex(signingKey)}`
}

/** Runs the schema text with its signing key as `$jwt_key`, then remembers what it applied. */
async function apply(db: Surreal, schema: string, signingKey: string | undefined): Promise<void> {
  await db.query(schema, { jwt_key: signingKey ?? ephemeralKey() })
  await db.query(rememberSchemaStatement, { schema: await markerOf(schema, signingKey) })
}

/**
 * Applies the schema text to an open database with the signing key its access methods sign
 * tokens with (a key of its own for this apply when none is given), and remembers it, as
 * `openLocalDb` does when the schema changed.
 */
export function applySchema(
  local: LocalDb,
  schema: string,
  signingKey?: string,
): ResultAsync<void, DataError> {
  return ResultAsync.fromPromise(apply(local.db, schema, signingKey), (cause) =>
    dataError('data:QUERY_FAILED', 'could not apply the schema', cause),
  )
}

/**
 * Connects to a local database and brings its schema up to date before anything
 * reads from it. A schema the database already applied with the same key is left alone:
 * without a fixed key, defining the access method again would give it a new signing key
 * and sign everyone out.
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

    if (applied !== (await markerOf(options.schema, options.signingKey))) {
      await apply(db, options.schema, options.signingKey)
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
