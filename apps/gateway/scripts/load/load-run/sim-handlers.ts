/** What a simulated device does with what its socket delivers, on its first open and after. */

import type { DeviceHandlers } from '../load-device'

import type { Run, Sim } from './state'

/** The wait of a device's open for its first snapshot, which its handlers settle. */
export interface Opening {
  snapshotted: boolean
  resolve: () => void
  reject: (cause: Error) => void
}

/** A new opening, and the promise that resolves when its snapshot is imported. */
export function awaitSnapshot(): { opening: Opening; waiting: Promise<void> } {
  const opening: Opening = { snapshotted: false, resolve: () => undefined, reject: () => undefined }
  const waiting = new Promise<void>((resolve, reject) => {
    opening.resolve = resolve
    opening.reject = reject
  })

  // The timer can fire before the open resolves and the wait begins: no unhandled rejection.
  waiting.catch(() => undefined)

  return { opening, waiting }
}

/** Takes a closed device out of the live counts and stops its writing. */
export function retire(run: Run, sim: Sim): void {
  if (sim.retired) return

  sim.retired = true
  clearTimeout(sim.timer)
  run.live.set(sim.region, (run.live.get(sim.region) ?? 1) - 1)
}

/**
 * The handlers of `sim`'s socket. While `opening` is given and its snapshot has not come, a
 * problem or a close fails the open's wait; otherwise a problem is counted as an error and a
 * close retires the device, or, once the gateway's restart has begun, starts its reconnect.
 * The handlers of a socket opened again after a restart are given no opening.
 */
export function simHandlers(run: Run, sim: Sim, opening?: Opening): DeviceHandlers {
  const { counters, book } = run
  const snapshotted = (): boolean => opening === undefined || opening.snapshotted

  /** Counts a problem of an open device, or fails the wait for the snapshot. */
  const trouble = (text: string): void => {
    if (snapshotted()) counters.errors++
    else opening?.reject(new Error(text))
  }

  return {
    onUpdates: (message, at) => {
      // The arrival is the fan-out's end, until the restart: the epochs are final by then.
      if (!message.snapshot && !run.restart) book.received(message.region, message.head, at)

      sim.imports = sim.imports.then(() =>
        sim.doc.importRemote(message.bytes, message.head).match(
          () => {
            if (message.snapshot && opening) {
              opening.snapshotted = true
              opening.resolve()
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
      if (!snapshotted()) {
        trouble(`closed with ${code} before the snapshot`)
      } else if (!run.closing) {
        if (run.restart) {
          run.restart.onClose(sim, code)
        } else {
          counters.closes++
          retire(run, sim)
        }
      }
    },
  }
}
