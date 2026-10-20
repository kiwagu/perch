/**
 * Renewed pairs on their way to a device: those a socket could not deliver, parked for the
 * device's next hello with the refresh key the renewal spent (keyed by the device and a digest of
 * the key, so the key itself is never held), and the turns in which a device's key operations run
 * one at a time. Kept in the gateway's memory.
 */

import { createHash } from 'node:crypto'

import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'

import type { DeviceTokens } from './identity-sessions'

/** How long a renewed pair the device could not take waits for its next hello. */
const PARKED_MS = 60_000

/** A device and the refresh key it presents, or that a renewal spends. */
export interface PairKey {
  readonly device: string
  readonly refresh: string
}

/** A pair parked for a device, and the identity it signs in. */
export interface ParkedPair {
  readonly identity: IdentityId
  readonly tokens: DeviceTokens
}

/** A pair parked for a device of an identity, until the moment it is no longer handed out. */
interface Parked extends ParkedPair {
  readonly device: string
  readonly until: number
}

/** Where a pair waits: the device and a digest of the refresh key. */
function keyOf(input: PairKey): string {
  return `${input.device}#${createHash('sha256').update(input.refresh).digest('hex')}`
}

export class PendingPairs {
  readonly #clock: Clock
  readonly #parked = new Map<string, Parked>()
  /** The last key operation of each device, which the next one waits for. */
  readonly #turns = new Map<string, Promise<void>>()

  constructor(clock: Clock) {
    this.#clock = clock
  }

  /**
   * Parks the renewed pair `tokens` that `device` could not take, for its next hello with the
   * refresh key the renewal spent; it is handed out once, within 60 seconds.
   */
  park(input: {
    readonly identity: IdentityId
    readonly device: string
    readonly spentRefresh: string
    readonly tokens: DeviceTokens
  }): void {
    const now = this.#clock.now()

    for (const [key, parked] of this.#parked) {
      if (parked.until <= now) {
        this.#parked.delete(key)
      }
    }

    this.#parked.set(keyOf({ device: input.device, refresh: input.spentRefresh }), {
      identity: input.identity,
      device: input.device,
      tokens: input.tokens,
      until: now + PARKED_MS,
    })
  }

  /**
   * Runs `work` once every key operation of `device` started before it has ended: a device's keys
   * are checked, renewed and handed out one operation at a time, across all its sockets, so no two
   * of them spend one single-use refresh key, and a pair one of them parks is there for the next.
   */
  async exclusively<T>(device: string, work: () => Promise<T>): Promise<T> {
    const turn = (this.#turns.get(device) ?? Promise.resolve()).then(work)
    const ended = turn.then(
      () => undefined,
      () => undefined,
    )

    this.#turns.set(device, ended)

    try {
      return await turn
    } finally {
      if (this.#turns.get(device) === ended) {
        this.#turns.delete(device)
      }
    }
  }

  /**
   * The pair parked for the device and the spent refresh key it presents, taken out with the
   * identity it signs in; `undefined` when none is parked or 60 s passed since it was last parked.
   */
  parked(input: PairKey): ParkedPair | undefined {
    const key = keyOf(input)
    const parked = this.#parked.get(key)

    this.#parked.delete(key)

    return parked && parked.until > this.#clock.now()
      ? { identity: parked.identity, tokens: parked.tokens }
      : undefined
  }

  /**
   * Forgets every pair parked for `device` of `identity`, or for every device of the identity when
   * none is named: it was signed out.
   */
  unpark(identity: IdentityId, device?: string): void {
    for (const [key, parked] of this.#parked) {
      if (parked.identity === identity && (device === undefined || parked.device === device)) {
        this.#parked.delete(key)
      }
    }
  }
}
