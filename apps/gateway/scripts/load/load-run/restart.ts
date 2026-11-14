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
import { sleep } from './pacing'
import { reconnectSim } from './sim-reconnect'
import { fail, type Restart, type Run, resetCounters } from './state'

/** The step ends this long after the old gateway was stopped, whoever is not back by then. */
const RESTART_DEADLINE_MS = 120_000
const RESTART_POLL_MS = 100

/** Waits until no device is waiting to come back, or until `deadline` (a `performance.now()`). */
async function untilBack(restart: Restart, deadline: number): Promise<void> {
  const waiting = (): boolean => [...restart.devices.values()].includes('waiting')

  while (waiting() && performance.now() < deadline) await sleep(RESTART_POLL_MS)
}

/** How many devices of the step stand as `standing`. */
function count(restart: Restart, standing: 'waiting' | 'ended'): number {
  return [...restart.devices.values()].filter((value) => value === standing).length
}

/**
 * Restarts the gateway under the devices that are live and measures the return, printing the
 * step's header and row. A new gateway that does not start throws. The restart stays marked on
 * the run: what the devices receive after it no longer feeds the latency book.
 */
export async function runRestart(run: Run): Promise<RestartReport> {
  const old = run.gateway ?? fail('no gateway to restart')
  const devices = liveSims(run)
  // The container is looked up before the stop, so docker's time is not the step's.
  const readSurreal = run.args.surrealContainer
    ? await containerCpuReader(run.args.surrealContainer)
    : undefined
  const abort = new AbortController()
  const loops: Promise<void>[] = []
  const restart: Restart = {
    devices: new Map(devices.map((sim) => [sim, 'waiting'])),
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
  const stoppedAt = performance.now()

  try {
    await stopGateway(old)

    const gateway = await startGateway(run.args, (child) => {
      run.gateway = child
      sampled.gateway = sampleCpu(() => procStats(child.pid).cpuSeconds)
    })
    const healthyAt = performance.now()

    await untilBack(restart, stoppedAt + RESTART_DEADLINE_MS)

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
    abort.abort()
    sampled.gateway?.()
    stopSurrealSamples?.()
    await Promise.allSettled(loops)
  }
}
