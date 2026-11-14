/** A simulated device's way back after its socket closed in the gateway's restart. */

import { type EndReason, endingOf, WELCOME_TIMEOUT_MS } from '@workspace/replica/sync'

import { LoadDevice } from '../load-device'

import { syncUrl } from './devices'
import { reconnect } from './reconnect'
import { simHandlers } from './sim-handlers'
import type { Restart, Run, Sim } from './state'

/**
 * The version a device subscribes its region with, as the client engine's first subscription of
 * a connection does: `null` when the copy is empty, else its encoded version vector, as bytes
 * of their own.
 */
function subscribedVersion(sim: Sim): Uint8Array<ArrayBuffer> | null {
  const version = sim.doc.doc.version()

  return version.length() === 0 ? null : new Uint8Array(version.encode())
}

function end(restart: Restart, sim: Sim, reason: EndReason): void {
  restart.devices.set(sim, 'ended')
  console.error(`${sim.label}: the gateway ended it after the restart: ${reason}`)
}

/**
 * What the transport does when its socket closes with `code`: a close that ends the channel for
 * good ends the device; any other starts its reconnect loop. The loop opens again by the
 * transport's own delay and welcome timeout. On the welcome the device records the time and
 * subscribes its region again with its copy's version, keeping the handlers it had. A welcome
 * after the step's deadline does not count: the loop stops, and an open still waiting for its
 * welcome when `signal` aborts is cancelled. Resolves once the device is back or ended, or the
 * loop stopped.
 */
export async function reconnectSim(
  run: Run,
  restart: Restart,
  sim: Sim,
  code: number,
  signal: AbortSignal,
): Promise<void> {
  const ending = endingOf(code)

  if (ending) {
    end(restart, sim, ending)

    return
  }

  restart.devices.set(sim, 'waiting')

  const outcome = await reconnect(
    async (cancel) =>
      (
        await LoadDevice.open(syncUrl(run), sim.account.token, simHandlers(run, sim), {
          timeoutMs: WELCOME_TIMEOUT_MS,
          device: sim.account.device,
          signal: cancel,
        })
      ).device,
    {
      signal,
      until: restart.deadlineAt,
      onFailed: () => {
        restart.failedHellos++
      },
    },
  )

  if (outcome.kind === 'ended') {
    end(restart, sim, outcome.reason)
  } else if (outcome.kind === 'welcomed') {
    const device = outcome.value

    if (run.closing) {
      device.close()

      return
    }

    restart.lastWelcomeAt = outcome.at
    restart.devices.set(sim, 'back')
    sim.device = device
    device.subscribe(sim.region, subscribedVersion(sim))
  }
}
