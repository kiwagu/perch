import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Logger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'

import type { MembershipTurns } from './turns'

/**
 * How long the re-tells of one identity wait in a row, before the jitter; past the list the last
 * delay repeats.
 */
const RETELL_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000] as const

/** What the re-tells run on, which the composition root chooses. */
export interface RetellOptions {
  /** Times the re-tells. */
  readonly clock: Clock
  /** Draws the jitter of each delay, from 0 to 1. */
  readonly random: () => number
  /** Hears a tell that failed, by its code and the attempt it was. */
  readonly log: Pick<Logger, 'error'>
}

export interface MembershipRetellsOptions extends RetellOptions {
  /** The turns a re-tell takes, so it runs between the changes of its identity. */
  readonly turns: Pick<MembershipTurns, 'ofIdentity'>
  /** One try at telling `identity` its memberships as they are now, read afresh. */
  readonly attempt: (identity: IdentityId) => ResultAsync<void, DataError>
}

/**
 * The pending re-tell of one identity. Each one made is a new object, so a re-tell queued by an
 * entry that was deleted since knows itself stale even when the identity has a newer entry.
 */
interface Retell {
  /** The attempt that failed last: 0 for the tell that made the entry, then each re-tell's. */
  attempt: number
  /** Cancels the armed delay; none while the re-tell waits for its turn or runs. */
  cancel: (() => void) | undefined
}

/**
 * The re-tells of identities whose memberships could not be told, kept in memory: a crash closes
 * every socket and every device's welcome reads the directory, so nothing durable is needed. An
 * identity has one entry at most. A failed tell makes it when there is none, logs, and arms the
 * first delay; a failed tell while one exists changes nothing. Any successful tell of the identity
 * deletes it. Once a delay passes, the re-tell queues on the identity's turn and, if its entry is
 * still the one that armed it and the store is open, tries the tell again there: a success deletes
 * the entry, a failure logs and arms the next delay. The delays are 1, 2, 4, 8, 16 and 30 s in a
 * row, the last repeating, each times a factor drawn from 0.8 to 1.2 so that identities failed
 * together do not retry together. A re-tell carries no list: it reads one in the turn, so dropping
 * it for another tell's success never loses newer memberships, and no older list reaches a device
 * after a newer one.
 */
export class MembershipRetells {
  readonly #options: MembershipRetellsOptions
  readonly #entries = new Map<IdentityId, Retell>()
  /** The re-tells whose try started, until each has settled. */
  readonly #running = new Set<Promise<void>>()
  #closed = false

  constructor(options: MembershipRetellsOptions) {
    this.#options = options
  }

  /** How many identities have a re-tell pending. */
  get size(): number {
    return this.#entries.size
  }

  /**
   * Hears how a tell of `identity` by a change ended. It is called inside the identity's turn
   * only, so a later change's outcome can never reach the entry before an earlier one's.
   */
  settled(identity: IdentityId, outcome: Result<void, DataError>): void {
    if (outcome.isOk()) {
      this.#entries.get(identity)?.cancel?.()
      this.#entries.delete(identity)

      return
    }

    if (this.#closed || this.#entries.has(identity)) {
      return
    }

    const entry: Retell = { attempt: 0, cancel: undefined }

    this.#entries.set(identity, entry)
    this.#failed(identity, entry, outcome.error)
  }

  /**
   * Stops for good: no entry is made or armed again, every armed delay is cancelled and every
   * entry dropped. Resolves once every re-tell whose try had started has settled; one still
   * waiting for its turn finds its entry gone and does nothing, so this never waits on a change.
   */
  async close(): Promise<void> {
    this.#closed = true

    for (const entry of this.#entries.values()) {
      entry.cancel?.()
    }

    this.#entries.clear()
    await Promise.all(this.#running)
  }

  /** Logs the failed `attempt` of `entry` and arms the delay before the next. */
  #failed(identity: IdentityId, entry: Retell, error: DataError): void {
    const { clock, random, log, turns } = this.#options
    // Past the list, its last delay repeats.
    const base = RETELL_DELAYS_MS[entry.attempt] ?? RETELL_DELAYS_MS[5]
    // Rounded to whole milliseconds, which the delay of a clock is counted in.
    const delay = Math.round(base * (0.8 + 0.4 * random()))

    log.error({ code: error.code, attempt: entry.attempt }, error.message)
    entry.cancel = clock.schedule(delay, () => {
      entry.cancel = undefined
      // The re-tell answers ok whatever its try answered: there is no failure to handle.
      void turns
        .ofIdentity(identity, () => this.#retell(identity, entry))
        .match(
          () => undefined,
          () => undefined,
        )
    })
  }

  /**
   * The re-tell `entry` armed, run in the identity's turn. It answers ok whatever the try
   * answered, so the turn it runs in never fails for it.
   */
  #retell(identity: IdentityId, entry: Retell): ResultAsync<void, never> {
    if (this.#closed || this.#entries.get(identity) !== entry) {
      return okAsync(undefined)
    }

    // A try that throws, at once or later, is a failed one like any other.
    const tried = Promise.resolve()
      .then(() => this.#options.attempt(identity))
      .catch((cause: unknown) =>
        err(dataError('data:WRITE_FAILED', `could not tell the memberships of ${identity}`, cause)),
      )
    const running = tried.then((outcome) => {
      if (outcome.isOk()) {
        this.#entries.delete(identity)
      } else if (!this.#closed) {
        entry.attempt += 1
        this.#failed(identity, entry, outcome.error)
      }
    })

    this.#running.add(running)
    void running.then(() => this.#running.delete(running))

    return new ResultAsync(running.then(() => ok(undefined)))
  }
}
