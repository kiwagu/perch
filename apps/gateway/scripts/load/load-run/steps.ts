/** The steps of a load run: each adds devices, holds the writes, drains and measures. */

import {
  dockerStats,
  formatRow,
  percentile,
  procStats,
  type Step,
  type StepReport,
  stepPlan,
  TABLE_HEADER,
} from '../metrics'

import { addDevices, liveSims, scheduleWrite } from './devices'
import { sleep } from './pacing'
import { type Run, resetCounters } from './state'

const DRAIN_TIMEOUT_MS = 5_000
const DRAIN_POLL_MS = 100
const ACK_P95_LIMIT_MS = 1_000
const FANOUT_P95_LIMIT_MS = 2_000

/** Lets every live writer write for `hold` seconds; answers what the gateway used meanwhile. */
async function hold(run: Run, pid: number): Promise<{ rssMiB: number; cpuPercent: number }> {
  const before = procStats(pid)
  const startedAt = performance.now()

  run.writing = true

  for (const sim of liveSims(run).filter((candidate) => candidate.writer)) {
    scheduleWrite(run, sim, Math.random() * (1000 / run.args.rate))
  }

  await sleep(run.args.hold * 1000)

  run.writing = false

  for (const sim of run.sims) clearTimeout(sim.timer)

  const after = procStats(pid)
  const elapsedS = (performance.now() - startedAt) / 1000

  return {
    rssMiB: after.rssMiB,
    cpuPercent: ((after.cpuSeconds - before.cpuSeconds) / elapsedS) * 100,
  }
}

/** Waits up to 5 s for the epoch's pushes to be acked and delivered, polling every 100 ms. */
async function drain(run: Run, epoch: number): Promise<void> {
  const deadline = performance.now() + DRAIN_TIMEOUT_MS

  for (;;) {
    const { unacked, undelivered } = run.book.status(epoch)

    if ((unacked === 0 && undelivered === 0) || performance.now() >= deadline) return

    await sleep(DRAIN_POLL_MS)
  }
}

/** Measures one step: its devices written to for the hold, then the latencies and stats. */
async function measure(run: Run, step: Step, pid: number): Promise<StepReport> {
  resetCounters(run.counters)
  await addDevices(run, step)

  const epoch = run.book.startEpoch()
  const gateway = await hold(run, pid)

  await drain(run, epoch)

  const live = liveSims(run)
  const writers = live.filter((sim) => sim.writer).length
  const { ack, fanout, pushes, expected, unacked, undelivered } = run.book.finalize(epoch)
  const { firstReject, errors, closes, asked, accepted, other } = run.counters

  // The step is cut here: the docker call below may take as long as it likes.
  const surreal = run.args.surrealContainer
    ? await dockerStats(run.args.surrealContainer)
    : undefined
  const ackP95 = percentile(ack, 0.95)
  const fanoutP95 = percentile(fanout, 0.95)

  if (firstReject)
    console.log(`load: step of ${live.length} devices: rejected, first ${firstReject}`)

  return {
    devices: live.length,
    writers,
    offeredOpsPerS: writers * run.args.rate,
    pushes,
    ackP50: percentile(ack, 0.5),
    ackP95,
    fanoutP50: percentile(fanout, 0.5),
    fanoutP95,
    fanoutSamples: fanout.length,
    gatewayRssMiB: gateway.rssMiB,
    gatewayCpuPercent: gateway.cpuPercent,
    ...(surreal ? { surreal } : {}),
    compactions: { asked, accepted, other },
    errors,
    closes,
    unacked,
    undelivered,
    degraded:
      ackP95 > ACK_P95_LIMIT_MS ||
      fanoutP95 > FANOUT_P95_LIMIT_MS ||
      errors > 0 ||
      closes > 0 ||
      unacked > 0 ||
      undelivered > 0 ||
      (pushes > 0 && ack.length === 0) ||
      (pushes > 0 && expected > 0 && fanout.length === 0),
  }
}

/** Runs the steps of the plan, printing a row per step; stops early on a degraded step if asked. */
export async function runLoad(run: Run, pid: number): Promise<StepReport[]> {
  const reports: StepReport[] = []

  console.log(TABLE_HEADER)

  for (const step of stepPlan(run.args.devices)) {
    const report = await measure(run, step, pid)

    console.log(formatRow(report))
    reports.push(report)

    if (report.degraded && run.args.stopOnDegrade) break
  }

  return reports
}
