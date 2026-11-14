/**
 * The restart step of a load run: with every device still connected the run stops its gateway,
 * starts a new one on the same port and measures how the devices come back. The devices are raw
 * protocol clients, so each gets the transport's reconnect loop (`reconnect.ts`).
 */

import {
  type CpuSample,
  containerCpuReader,
  formatRestartRow,
  procStats,
  RESTART_HEADER,
  type RestartReport,
  restartReport,
  sampleCpu,
} from '../metrics'

import { liveSims } from './devices'
import { startGateway, stopGateway } from './gateway'
import { pause } from './pacing'
import { reconnectSim } from './sim-reconnect'
import { fail, type Restart, type Run, resetCounters } from './state'

/** The step ends this long after the old gateway was stopped, whoever is not back by then. */
const RESTART_DEADLINE_MS = 120_000
const RESTART_POLL_MS = 100

/** Waits until no device is waiting to come back, or until `signal` aborts, the deadline. */
async function untilBack(restart: Restart, signal: AbortSignal): Promise<void> {
  const waiting = (): boolean => [...restart.devices.values()].includes('waiting')

  while (waiting() && !signal.aborted) await pause(RESTART_POLL_MS, signal)
}

/** How many devices of the step stand as `standing`. */
function count(restart: Restart, standing: 'waiting' | 'ended'): number {
  return [...restart.devices.values()].filter((value) => value === standing).length
}

/**
 * Restarts the gateway under the devices that are live and measures the return, printing the
 * step's header and row; `undefined`, with a note, when no device is live to be brought back. A
 * timer at the deadline aborts the loops: an open still waiting for its welcome is cancelled and
 * its socket closed, and a welcome after the deadline does not count. A new gateway that does
 * not start throws. The restart stays marked on the run: what the devices receive after it no
 * longer feeds the latency book.
 */
export async function runRestart(run: Run): Promise<RestartReport | undefined> {
  const old = run.gateway ?? fail('no gateway to restart')
  // Docker is asked first: a device can retire while it answers, and nothing may be awaited
  // between taking the live devices, routing their closes and stopping the gateway.
  const readSurreal = run.args.surrealContainer
    ? await containerCpuReader(run.args.surrealContainer)
    : undefined
  const devices = liveSims(run)

  if (devices.length === 0) {
    console.log('load: restart: no device is live, so none is brought back: skipped')

    return undefined
  }

  const abort = new AbortController()
  const loops: Promise<void>[] = []
  const stoppedAt = performance.now()
  const restart: Restart = {
    devices: new Map(devices.map((sim) => [sim, 'waiting'])),
    deadlineAt: stoppedAt + RESTART_DEADLINE_MS,
    failedHellos: 0,
    lastWelcomeAt: undefined,
    onClose: (sim, code) => {
      if (restart.devices.has(sim) && !abort.signal.aborted) {
        loops.push(reconnectSim(run, restart, sim, code, abort.signal))
      }
    },
  }
  // The new gateway's sampler starts at its spawn, which the start reports.
  const sampled: { gateway?: () => CpuSample[] } = {}

  resetCounters(run.counters)
  run.restart = restart

  const stopSurrealSamples = readSurreal ? sampleCpu(readSurreal) : undefined
  const cutoff = setTimeout(() => abort.abort(), RESTART_DEADLINE_MS)

  try {
    // The stop sends its SIGTERM at once: t0 is the instant taken above.
    await stopGateway(old)

    const gateway = await startGateway(run.args, (child) => {
      run.gateway = child
      sampled.gateway = sampleCpu(() => procStats(child.pid).cpuSeconds)
    })
    const healthyAt = performance.now()

    await untilBack(restart, abort.signal)

    const gatewayRssMiB = procStats(gateway.pid).rssMiB
    const report = restartReport({
      devices: devices.length,
      stoppedAt,
      healthyAt,
      lastWelcomeAt: restart.lastWelcomeAt,
      failedHellos: restart.failedHellos,
      gatewayCpu: sampled.gateway?.() ?? [],
      surrealCpu: stopSurrealSamples?.() ?? [],
      gatewayRssMiB,
      notBack: count(restart, 'waiting'),
      ended: count(restart, 'ended'),
    })

    console.log('')
    console.log(RESTART_HEADER)
    console.log(formatRestartRow(report))

    if (run.counters.errors > 0) {
      console.log(`load: restart: the devices counted ${run.counters.errors} errors after it`)
    }

    return report
  } finally {
    clearTimeout(cutoff)
    abort.abort()
    sampled.gateway?.()
    stopSurrealSamples?.()
    await Promise.allSettled(loops)
  }
}
