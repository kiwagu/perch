/** The simulated devices of a load run: opening each one, its writes, and its retirement. */

import { noteIdFactory } from '@workspace/ids'
import { RegionDoc } from '@workspace/replica'

import { noteCreate } from '../../../src/sync/__fixtures__/note'
import type { SignedIn } from '../../smoke'
import { LoadDevice } from '../load-device'
import type { Step } from '../metrics'

import { organise, signUp } from './accounts'
import { inParallel } from './pacing'
import { fail, type Run, type Sim } from './state'

const SNAPSHOT_TIMEOUT_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 30_000

/**
 * Opens the device of an account, subscribes it to its region and waits for the snapshot.
 * A device whose open fails, whose snapshot fails to import or does not come within 30 s, or
 * that hears an error or a close before it is counted as an error and dropped: `undefined`.
 */
async function openSim(
  run: Run,
  account: SignedIn,
  region: string,
  n: number,
): Promise<Sim | undefined> {
  const sim: Sim = {
    label: `dev${n}`,
    account,
    region,
    doc: RegionDoc.inMemory('tenant', region),
    device: undefined,
    imports: Promise.resolve(),
    writer: false,
    retired: false,
    batch: 0,
    timer: undefined,
  }
  const { counters, book } = run
  let snapshotted = false
  let snapshot: { resolve: () => void; reject: (cause: Error) => void } | undefined
  const waiting = new Promise<void>((resolve, reject) => {
    snapshot = { resolve, reject }
  })

  // The timer can fire before the open resolves and the wait begins: no unhandled rejection.
  waiting.catch(() => undefined)

  let timeout: ReturnType<typeof setTimeout> | undefined

  /** Counts a problem of an open device, or fails the wait for the snapshot. */
  const trouble = (text: string): void => {
    if (snapshotted) counters.errors++
    else snapshot?.reject(new Error(text))
  }

  try {
    const { device } = await LoadDevice.open(
      `${run.base.replace(/^http/, 'ws')}/sync`,
      account.token,
      {
        onUpdates: (message, at) => {
          // The arrival is the fan-out's end; a failed import is an error of its own.
          if (!message.snapshot) book.received(message.region, message.head, at)

          sim.imports = sim.imports.then(() =>
            sim.doc.importRemote(message.bytes, message.head).match(
              () => {
                if (message.snapshot) {
                  snapshotted = true
                  snapshot?.resolve()
                }
              },
              (error) => trouble(`import failed: ${error.code} ${error.message}`),
            ),
          )
          // A throw must not break the chain: the next updates still import.
          sim.imports = sim.imports.catch(() => {
            counters.errors++
          })
        },
        onAck: (message, at) => {
          book.acked(sim.label, message.batch, message.region, message.head, at)

          if (message.compact) {
            counters.asked++
            sim.device?.compact(
              sim.region,
              message.head,
              new Uint8Array(sim.doc.doc.export({ mode: 'snapshot' })),
            )
          }
        },
        onCompaction: (message) => {
          if (message.outcome === 'accepted') counters.accepted++
          else counters.other++
        },
        onReject: (message) => {
          counters.errors++
          counters.firstReject ??= `${message.reason} (${message.detail})`
        },
        onError: trouble,
        onClose: (code) => {
          if (!snapshotted) trouble(`closed with ${code} before the snapshot`)
          else if (!run.closing) {
            counters.closes++
            retire(run, sim)
          }
        },
      },
      { timeoutMs: HANDSHAKE_TIMEOUT_MS, device: account.device },
    )

    timeout = setTimeout(
      () => snapshot?.reject(new Error(`no snapshot within ${SNAPSHOT_TIMEOUT_MS / 1000} s`)),
      SNAPSHOT_TIMEOUT_MS,
    )

    sim.device = device
    device.subscribe(region)
    await waiting
    run.live.set(region, (run.live.get(region) ?? 0) + 1)

    return sim
  } catch (cause) {
    counters.errors++
    console.error(
      `${sim.label}: dropped: ${cause instanceof Error ? cause.message : String(cause)}`,
    )
    sim.device?.close()
    sim.retired = true

    return undefined
  } finally {
    clearTimeout(timeout)
  }
}

/** Takes a closed device out of the live counts and stops its writing. */
function retire(run: Run, sim: Sim): void {
  if (sim.retired) return

  sim.retired = true
  clearTimeout(sim.timer)
  run.live.set(sim.region, (run.live.get(sim.region) ?? 1) - 1)
}

/** Appends one note to the sim's region and pushes it. */
async function write(run: Run, sim: Sim): Promise<void> {
  if (sim.retired) return

  const created = await noteCreate(sim.doc, {
    id: noteIdFactory.create(),
    author: sim.account.identity.id,
    text: `note ${sim.batch + 1} from ${sim.label} at ${new Date().toISOString()}`,
  })

  created.match(
    (update) => {
      const others = Math.max(0, (run.live.get(sim.region) ?? 1) - 1)

      run.book.pushed(sim.label, ++sim.batch, sim.region, performance.now(), others)
      sim.device?.push(sim.region, sim.batch, update)
    },
    (error) => {
      run.counters.errors++
      console.error(`${sim.label}: ${error.code} ${error.message}`)
    },
  )
}

/** Writes a note after `delay` ms and again every `1000 / rate` ms while the run is writing. */
export function scheduleWrite(run: Run, sim: Sim, delay: number): void {
  sim.timer = setTimeout(() => {
    if (!run.writing || sim.retired) return

    void write(run, sim)
    scheduleWrite(run, sim, 1000 / run.args.rate)
  }, delay)
}

/** The indexes of `regions` in an order that takes the devices of each region in turn. */
function roundRobin(regions: readonly string[]): number[] {
  const rank = new Map<string, number>()
  const ranked = regions.map((region, index) => {
    const turn = rank.get(region) ?? 0

    rank.set(region, turn + 1)

    return { index, turn }
  })

  return ranked.sort((a, b) => a.turn - b.turn || a.index - b.index).map(({ index }) => index)
}

/** Brings a step's new accounts, organisations and devices up; writers spread over the regions. */
export async function addDevices(run: Run, step: Step): Promise<void> {
  const accounts = await signUp(run, step.add)
  const regions = await organise(run, accounts)
  const opened = await inParallel(accounts, (account, i) =>
    openSim(run, account, regions[i] ?? fail('no region'), run.attempted++),
  )
  const writers = roundRobin(regions).slice(0, Math.round(run.args.writers * step.add))

  for (const index of writers) {
    const sim = opened[index]

    if (sim) sim.writer = true
  }

  run.sims.push(...opened.filter((sim) => sim !== undefined))
}

/** The devices that are still open. */
export function liveSims(run: Run): Sim[] {
  return run.sims.filter((sim) => !sim.retired)
}

/** Closes every device of the run, cancelling its next write. */
export function closeDevices(run: Run): void {
  for (const sim of run.sims) {
    clearTimeout(sim.timer)
    sim.device?.close()
  }
}
