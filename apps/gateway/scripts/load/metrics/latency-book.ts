/** One push as the book follows it: its epoch, when it left, and what came of it. */
interface Push {
  readonly epoch: number
  readonly region: string
  readonly at: number
  /** How many other devices of its region were live when it left. */
  readonly expected: number
  delivered: number
  acked: boolean
  headKey: string | undefined
}

interface Epoch {
  ack: number[]
  fanout: number[]
  readonly pushes: Push[]
}

/** What an epoch measured, once its pushes had their time to be acked and delivered. */
export interface EpochResult {
  ack: number[]
  fanout: number[]
  pushes: number
  /** Deliveries the epoch's pushes should have made to other devices. */
  expected: number
  /** Pushes without an ack. */
  unacked: number
  /** Deliveries missing for the acked pushes. */
  undelivered: number
}

/**
 * Latency samples in milliseconds: a push to its ack, and a push to each other device that
 * received its head. Every push belongs to the epoch that was current when it left, and its
 * ack and deliveries count there however late they come, so a step's numbers account for
 * every push of the step. A receipt that beats its ack waits for it.
 */
export class LatencyBook {
  readonly #pushes = new Map<string, Push>()
  /** Keyed by region and head: every region counts its heads from 1. */
  readonly #byHead = new Map<string, Push>()
  readonly #early = new Map<string, number[]>()
  readonly #epochs = new Map<number, Epoch>()
  #current = 0

  /** Opens a new epoch, which the pushes from now on belong to. */
  startEpoch(): number {
    this.#current++
    this.#epochs.set(this.#current, { ack: [], fanout: [], pushes: [] })

    return this.#current
  }

  pushed(device: string, batch: number, region: string, at: number, expected: number): void {
    const epoch = this.#epochs.get(this.#current)

    if (!epoch) throw new Error('no epoch started')

    const push: Push = {
      epoch: this.#current,
      region,
      at,
      expected,
      delivered: 0,
      acked: false,
      headKey: undefined,
    }

    this.#pushes.set(`${device}#${batch}#${region}`, push)
    epoch.pushes.push(push)
  }

  acked(device: string, batch: number, region: string, head: number, at: number): void {
    const id = `${device}#${batch}#${region}`
    const push = this.#pushes.get(id)

    if (push === undefined) return

    const key = `${region}#${head}`

    push.acked = true
    push.headKey = key
    this.#epochs.get(push.epoch)?.ack.push(at - push.at)
    this.#pushes.delete(id)
    this.#byHead.set(key, push)

    for (const receivedAt of this.#early.get(key) ?? []) this.#delivered(push, receivedAt)

    this.#early.delete(key)
  }

  /** A device received `head` of `region`; a receipt before the head's ack waits for the ack. */
  received(region: string, head: number, at: number): void {
    const key = `${region}#${head}`
    const push = this.#byHead.get(key)

    if (push !== undefined) this.#delivered(push, at)
    else this.#early.set(key, [...(this.#early.get(key) ?? []), at])
  }

  /** What the epoch's pushes still lack: an ack, or deliveries to other devices. */
  status(epoch: number): { unacked: number; undelivered: number } {
    let unacked = 0
    let undelivered = 0

    for (const push of this.#epochs.get(epoch)?.pushes ?? []) {
      if (!push.acked) unacked++
      else undelivered += Math.max(0, push.expected - push.delivered)
    }

    return { unacked, undelivered }
  }

  /** The epoch's samples and counts; the epoch is forgotten, a later arrival for it ignored. */
  finalize(epoch: number): EpochResult {
    const found = this.#epochs.get(epoch)
    const pushes = found?.pushes ?? []
    const result: EpochResult = {
      ack: found?.ack ?? [],
      fanout: found?.fanout ?? [],
      pushes: pushes.length,
      expected: pushes.reduce((sum, push) => sum + push.expected, 0),
      ...this.status(epoch),
    }

    for (const push of pushes) {
      if (push.headKey !== undefined) this.#byHead.delete(push.headKey)
    }

    for (const [id, push] of this.#pushes) {
      if (push.epoch === epoch) this.#pushes.delete(id)
    }

    this.#epochs.delete(epoch)
    this.#dropStaleReceipts()

    return result
  }

  /** Drops the receipts of regions with no unacked push left that could still claim them. */
  #dropStaleReceipts(): void {
    const pending = new Set([...this.#pushes.values()].map((push) => push.region))

    for (const key of this.#early.keys()) {
      if (!pending.has(key.slice(0, key.lastIndexOf('#')))) this.#early.delete(key)
    }
  }

  #delivered(push: Push, at: number): void {
    push.delivered++
    this.#epochs.get(push.epoch)?.fanout.push(at - push.at)
  }
}
