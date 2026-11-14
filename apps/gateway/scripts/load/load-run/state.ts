/** What a load run holds while it runs: its devices, what they count, and how it fails. */

import type { Mailbox } from '@workspace/mailbox'
import type { RegionDoc } from '@workspace/replica'

import type { SignedIn } from '../../smoke'
import type { LoadDevice } from '../load-device'
import type { LatencyBook, LoadArgs } from '../metrics'

/** One simulated device: its socket, its copy of the organisation's region and its batches. */
export interface Sim {
  readonly label: string
  readonly account: SignedIn
  readonly region: string
  readonly doc: RegionDoc
  device: LoadDevice | undefined
  /** Imports of received updates, one after the other. */
  imports: Promise<void>
  writer: boolean
  /** A device whose socket closed: no longer written with, counted or delivered to. */
  retired: boolean
  batch: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** How a device that was live when the gateway was stopped stands once it is down. */
export type Standing = 'waiting' | 'back' | 'ended'

/** The gateway's restart, as the devices see it while it runs and after. */
export interface Restart {
  /** Where each device that was live when the gateway was stopped stands. */
  readonly devices: Map<Sim, Standing>
  /** The `performance.now()` after which a welcome no longer counts: the step's deadline. */
  readonly deadlineAt: number
  /** Opens of the reconnect loops that were rejected. */
  failedHellos: number
  /** `performance.now()` of the latest welcome after the restart; `undefined` before the first. */
  lastWelcomeAt: number | undefined
  /** A device's socket closed with `code`: its reconnect loop starts, or the close ends it. */
  readonly onClose: (sim: Sim, code: number) => void
}

/** What the devices count during a step, besides the latencies. */
export interface Counters {
  errors: number
  closes: number
  asked: number
  accepted: number
  other: number
  /** The reason and detail of the first reject of the step, to tell once. */
  firstReject: string | undefined
}

/** Everything the steps share. */
export interface Run {
  readonly id: string
  readonly args: LoadArgs
  readonly base: string
  /** The stand's mailbox, where each sign-up's verification mail is read. */
  readonly mailbox: Mailbox
  readonly password: string
  readonly book: LatencyBook
  readonly counters: Counters
  readonly sims: Sim[]
  /** Live (open, not retired) devices per region. */
  readonly live: Map<string, number>
  accounts: number
  /** Devices whose open was attempted; the labels count them. */
  attempted: number
  organisations: number
  /** Whether the writers write; a step switches it on for its hold. */
  writing: boolean
  closing: boolean
  /** The gateway child, the latest one after a restart; `undefined` before it is spawned. */
  gateway: Bun.Subprocess | undefined
  /**
   * Set when the restart begins and kept: from then on a device's close starts its reconnect
   * instead of retiring it, and what the devices receive no longer feeds the latency book.
   */
  restart: Restart | undefined
}

export function fail(message: string): never {
  throw new Error(message)
}

export function resetCounters(counters: Counters): void {
  counters.errors = 0
  counters.closes = 0
  counters.asked = 0
  counters.accepted = 0
  counters.other = 0
  counters.firstReject = undefined
}
