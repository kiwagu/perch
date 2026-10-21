import { err, errAsync, ok, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import type { Clock } from '@workspace/replica'

/** A hold on one organisation's database; the database stays open until every hold is released. */
export interface TenantHandle {
  readonly local: LocalDb
  /** Lets the database go; releasing the same handle again does nothing. */
  release(): void
}

export interface TenantDatabasesOptions {
  /** Opens the database of one organisation as the gateway's user; openLocalDb in the app, an embedded database in tests. */
  readonly open: (key: string) => ResultAsync<LocalDb, DataError>
  readonly clock: Clock
  /** How long a database nobody holds stays open; 5 minutes by default. */
  readonly idleCloseMs?: number
  /** Hears of an open that failed (its holders are answered with the error too) and of a close that failed. */
  readonly onError: (error: DataError) => void
}

/** One organisation's database, from its first acquire until it closes. */
interface Entry {
  /** Settles once the database is open, or failed to open; every holder waits on the same one. */
  readonly opening: ResultAsync<LocalDb, DataError>
  holders: number
  /** Cancels the close scheduled when the last holder released the database. */
  cancelClose: (() => void) | undefined
  /** Taken out of the map by `evict`: closes once its last holder releases it. */
  evicted: boolean
  /** Settles once the database closed; set when its close began, so it closes once. */
  closing: Promise<void> | undefined
}

const FIVE_MINUTES = 5 * 60_000

/** The answer to an acquire once the databases are closed: the gateway is shutting down. */
function closedError(key: string): DataError {
  return dataError(
    'data:OPEN_FAILED',
    `the database of organisation ${key} is not served: the gateway is shutting down`,
  )
}

/**
 * The databases of the organisations the gateway serves: one connection per organisation,
 * opened on first use, shared by every holder and closed once nobody has held it for the idle
 * time. An acquire that comes while the close is under way opens a new connection. Once `close`
 * was called it hands out no database, not even one whose open was under way.
 */
export class TenantDatabases {
  readonly #entries = new Map<string, Entry>()
  /** The entries `evict` took out of the map that have not closed yet, with their keys. */
  readonly #evicted = new Map<Entry, string>()
  /** Closes under way, so `close` waits for them. */
  readonly #closing = new Set<Promise<void>>()
  readonly #open: (key: string) => ResultAsync<LocalDb, DataError>
  readonly #clock: Clock
  readonly #idleCloseMs: number
  readonly #onError: (error: DataError) => void
  #closed = false

  constructor(options: TenantDatabasesOptions) {
    this.#open = options.open
    this.#clock = options.clock
    this.#idleCloseMs = options.idleCloseMs ?? FIVE_MINUTES
    this.#onError = options.onError
  }

  /** The organisation's database, opened on first use; the handle must be released. */
  acquire(key: string): ResultAsync<TenantHandle, DataError> {
    if (this.#closed) {
      return errAsync(closedError(key))
    }

    const entry = this.#entries.get(key) ?? this.#start(key)

    entry.holders += 1
    entry.cancelClose?.()
    entry.cancelClose = undefined

    return entry.opening
      .andThen((local) =>
        this.#closed ? err(closedError(key)) : ok(this.#handle(key, entry, local)),
      )
      .mapErr((error) => {
        entry.holders -= 1
        // An evicted database no holder took is left to nobody: it closes now.
        this.#closeEvicted(key, entry)

        return error
      })
  }

  /**
   * Forgets the cached connection to the organisation's database, which the caller has just
   * (re)defined: the next acquire opens a new one and applies the schema. The old connection
   * closes once its holders release it. Does nothing when none is cached.
   */
  evict(key: string): void {
    const entry = this.#entries.get(key)

    if (!entry) {
      return
    }

    this.#entries.delete(key)
    this.#evicted.set(entry, key)
    entry.cancelClose?.()
    entry.cancelClose = undefined
    entry.evicted = true
    this.#closeEvicted(key, entry)
  }

  /**
   * Closes every database, held or not, evicted ones included, also one whose open is under way,
   * and waits for it; no database is handed out from then on.
   */
  async close(): Promise<void> {
    this.#closed = true

    const entries = [
      ...this.#entries.entries(),
      ...[...this.#evicted].map(([entry, key]) => [key, entry] as const),
    ]

    this.#entries.clear()

    for (const [, entry] of entries) {
      entry.cancelClose?.()
      entry.cancelClose = undefined
    }

    await Promise.all([
      ...entries.map(([key, entry]) => this.#closeEntry(key, entry)),
      ...this.#closing,
    ])
  }

  #start(key: string): Entry {
    const entry: Entry = {
      opening: this.#open(key).mapErr((error) => {
        // The next acquire tries again.
        if (this.#entries.get(key) === entry) {
          this.#entries.delete(key)
        }

        this.#onError(error)

        return error
      }),
      holders: 0,
      cancelClose: undefined,
      evicted: false,
      closing: undefined,
    }

    this.#entries.set(key, entry)

    return entry
  }

  #handle(key: string, entry: Entry, local: LocalDb): TenantHandle {
    let released = false

    return {
      local,
      release: () => {
        if (released) {
          return
        }

        released = true
        entry.holders -= 1
        this.#closeWhenIdle(key, entry)
        this.#closeEvicted(key, entry)
      },
    }
  }

  /** Closes an evicted entry once nobody holds it. */
  #closeEvicted(key: string, entry: Entry): void {
    if (!entry.evicted || entry.holders > 0) {
      return
    }

    void this.#closeEntry(key, entry)
  }

  /** Schedules the close once nobody holds the database, unless `close` already took it. */
  #closeWhenIdle(key: string, entry: Entry): void {
    if (entry.holders > 0 || entry.cancelClose || this.#entries.get(key) !== entry) {
      return
    }

    entry.cancelClose = this.#clock.schedule(this.#idleCloseMs, () => {
      entry.cancelClose = undefined

      if (entry.holders === 0 && this.#entries.get(key) === entry) {
        this.#entries.delete(key)
        void this.#closeEntry(key, entry)
      }
    })
  }

  /** Closes the entry's database once, whoever asks first; `close` waits for it meanwhile. */
  #closeEntry(key: string, entry: Entry): Promise<void> {
    if (entry.closing) {
      return entry.closing
    }

    const closing = this.#closeOpened(key, entry).finally(() => {
      this.#closing.delete(closing)
      this.#evicted.delete(entry)
    })

    entry.closing = closing
    this.#closing.add(closing)

    return closing
  }

  /** Closes the entry's database once it has opened; a failure to open was reported already. */
  async #closeOpened(key: string, entry: Entry): Promise<void> {
    const opened = await entry.opening

    if (opened.isErr()) {
      return
    }

    await opened.value.close().catch((cause: unknown) => {
      this.#onError(
        dataError(
          'data:QUERY_FAILED',
          `could not close the database of organisation ${key}`,
          cause,
        ),
      )
    })
  }
}
