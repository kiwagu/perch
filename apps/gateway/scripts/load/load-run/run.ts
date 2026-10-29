/**
 * The run of the gateway load test behind `ws-clients.ts`: simulated devices drive a gateway
 * this process starts as a child, in front of a SurrealDB stand, in steps of growing device
 * counts. Each step prints one table row of latency, memory and CPU (see `metrics/`).
 * `ack` is the time from a push to its ack; `fanout` is the time from a push to the arrival
 * of its update at another device of the organisation, before the device imports it (the
 * import is the replica's own measure). `ops/s` is nominal, writers times the rate; `pushes`
 * is what was pushed. After the hold the step drains for up to 5 s: `unacked` pushes lack an
 * ack, `undelivered` counts the deliveries still missing to the region's other live devices.
 * Either one, an error, a close, a silent step or a fan-out without samples is degraded. The accounts and
 * organisations it signs up stay on the stand, for the sweep of `@example.test` accounts.
 */

import { hostname } from 'node:os'

import { LatencyBook, parseArgs, type StepReport } from '../metrics'

import { closeDevices } from './devices'
import { startGateway, stopGateway } from './gateway'
import type { Run } from './state'
import { runLoad } from './steps'

const SIGNAL_EXIT = 130

/** Closes every device and stops the gateway child: SIGTERM, then SIGKILL after 5 s. */
async function teardown(run: Run, gateway: Bun.Subprocess | undefined): Promise<void> {
  run.closing = true
  run.writing = false
  closeDevices(run)

  if (!gateway) return

  await stopGateway(gateway)
}

/** Runs the load test; resolves to the process's exit code. */
export async function runLoadTest(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const args = parseArgs(argv, env)
  const id = Date.now().toString(36)
  const startedAt = new Date().toISOString()
  const run: Run = {
    id,
    args,
    base: `http://127.0.0.1:${args.gatewayPort}`,
    password: crypto.randomUUID(),
    book: new LatencyBook(),
    counters: { errors: 0, closes: 0, asked: 0, accepted: 0, other: 0, firstReject: undefined },
    sims: [],
    live: new Map(),
    accounts: 0,
    attempted: 0,
    organisations: 0,
    writing: false,
    closing: false,
  }

  console.log(`load ${id}: stand ${args.surrealUrl}, gateway on port ${args.gatewayPort}`)

  let child: Bun.Subprocess | undefined
  const onSignal = (): void => {
    void teardown(run, child).then(() => process.exit(SIGNAL_EXIT))
  }

  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)

  const gateway = await startGateway(args, (spawned) => {
    child = spawned
  }).catch((cause: unknown) => {
    console.error(`load: ${cause instanceof Error ? cause.message : String(cause)}`)

    return undefined
  })

  if (!gateway) {
    await teardown(run, child)

    return 1
  }

  let failed = false
  let reports: StepReport[] = []

  try {
    reports = await runLoad(run, gateway.pid)
  } catch (cause) {
    failed = true
    console.error(`load: ${cause instanceof Error ? cause.message : String(cause)}`)
  }

  await teardown(run, gateway)

  if (args.json) {
    await Bun.write(
      args.json,
      JSON.stringify({ run: id, args, host: hostname(), startedAt, steps: reports }, null, 2),
    )
  }

  return failed ? 1 : 0
}
