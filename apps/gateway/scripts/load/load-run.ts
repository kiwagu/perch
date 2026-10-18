/**
 * The run of the gateway load test behind `ws-clients.ts`: simulated devices drive a gateway this process starts as a child,
 * in front of a SurrealDB stand, in steps of growing device counts. Each step prints one
 * table row of latency, memory and CPU (see `metrics.ts`). The accounts and organisations
 * it signs up stay on the stand, for the sweep of `@example.test` accounts.
 */

import { hostname } from 'node:os'
import { resolve } from 'node:path'

import { wsRpcUrl } from '@workspace/data/engines/remote'
import { noteIdFactory } from '@workspace/ids'
import { RegionDoc } from '@workspace/replica'

import { noteCreate } from '../../src/sync/__fixtures__/note'
import { call, postCredentials, type SignedIn } from '../smoke-http'

import { LoadDevice } from './load-device'
import {
  dockerStats,
  formatRow,
  LatencyBook,
  type LoadArgs,
  parseArgs,
  percentile,
  procStats,
  type Step,
  type StepReport,
  stepPlan,
  TABLE_HEADER,
} from './metrics'

const REPO_ROOT = resolve(import.meta.dir, '../../../..')
const HEALTH_TIMEOUT_MS = 30_000
const SIGN_UP_PARALLEL = 20
const ACK_P95_LIMIT_MS = 1_000
const FANOUT_P95_LIMIT_MS = 2_000

/** One simulated device: its socket, its copy of the organisation's region and its batches. */
interface Sim {
  readonly label: string
  readonly account: SignedIn
  readonly region: string
  readonly doc: RegionDoc
  device: LoadDevice | undefined
  writer: boolean
  batch: number
  timer: ReturnType<typeof setTimeout> | undefined
}

/** What the devices count during a step, besides the latencies. */
interface Counters {
  errors: number
  closes: number
  asked: number
  accepted: number
  other: number
}

/** Everything the steps share. */
interface Run {
  readonly id: string
  readonly args: LoadArgs
  readonly base: string
  readonly password: string
  readonly book: LatencyBook
  readonly counters: Counters
  readonly sims: Sim[]
  accounts: number
  organisations: number
  /** Whether the writers write; a step switches it on for its hold. */
  writing: boolean
  closing: boolean
}

function fail(message: string): never {
  throw new Error(message)
}

function resetCounters(counters: Counters): void {
  counters.errors = 0
  counters.closes = 0
  counters.asked = 0
  counters.accepted = 0
  counters.other = 0
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Starts the gateway as a child process and waits for its health to answer 200. */
async function startGateway(
  args: LoadArgs,
): Promise<Bun.Subprocess<'ignore', 'ignore', 'inherit'>> {
  const gateway = Bun.spawn(['bun', 'apps/gateway/src/index.ts'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      GATEWAY_PORT: String(args.gatewayPort),
      SURREAL_URL: wsRpcUrl(args.surrealUrl),
      GATEWAY_SURREAL_USER: args.gatewayUser,
      GATEWAY_SURREAL_PASS: args.gatewayPass,
      LOG_LEVEL: 'warn',
    },
    stdout: 'ignore',
    stderr: 'inherit',
  })
  const deadline = Date.now() + HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) fail(`the gateway exited with ${gateway.exitCode}`)

    const healthy = await fetch(`http://127.0.0.1:${args.gatewayPort}/health`).then(
      (response) => response.status === 200,
      () => false,
    )

    if (healthy) return gateway

    await sleep(250)
  }

  gateway.kill('SIGTERM')

  return fail(`the gateway did not answer /health within ${HEALTH_TIMEOUT_MS / 1000} s`)
}

/** Signs up `count` new accounts, `SIGN_UP_PARALLEL` at a time, numbered from `run.accounts`. */
async function signUp(run: Run, count: number): Promise<SignedIn[]> {
  const signedUp: SignedIn[] = []

  for (let from = 0; from < count; from += SIGN_UP_PARALLEL) {
    const batch = Array.from({ length: Math.min(SIGN_UP_PARALLEL, count - from) }, (_, i) =>
      postCredentials(run.base, '/auth/sign-up', {
        email: `load-${run.id}-${run.accounts + from + i}@example.test`,
        password: run.password,
      }),
    )

    signedUp.push(...(await Promise.all(batch)))
  }

  run.accounts += count

  return signedUp
}

/**
 * Groups the accounts `members` to an organisation: the first of a group creates it and
 * invites the rest. Answers each account with the region of its organisation.
 */
async function organise(run: Run, accounts: readonly SignedIn[]): Promise<string[]> {
  const regions: string[] = []

  for (let from = 0; from < accounts.length; from += run.args.members) {
    const group = accounts.slice(from, from + run.args.members)
    const creator = group[0] ?? fail('an empty group')
    const key = `load_${run.id}_${run.organisations++}`
    const token = creator.tokens.access
    const created = await call(run.base, 'POST', '/organisations', token, { key, name: key })

    if (created.status !== 201) fail(`organisation ${key}: ${created.status}`)

    for (const member of group.slice(1)) {
      const invited = await call(run.base, 'POST', `/organisations/${key}/members`, token, {
        email: member.identity.email,
      })

      if (invited.status !== 200) fail(`inviting into ${key}: ${invited.status}`)
    }

    regions.push(...group.map(() => `tenant:${key}`))
  }

  return regions
}

/** Opens the device of an account, subscribes it to its region and waits for the snapshot. */
async function openSim(run: Run, account: SignedIn, region: string, n: number): Promise<Sim> {
  const sim: Sim = {
    label: `dev${n}`,
    account,
    region,
    doc: RegionDoc.inMemory('tenant', region),
    device: undefined,
    writer: false,
    batch: 0,
    timer: undefined,
  }
  let snapshot: (() => void) | undefined
  const snapshotted = new Promise<void>((done) => {
    snapshot = done
  })
  const { counters, book } = run
  const { device } = await LoadDevice.open(
    `${run.base.replace(/^http/, 'ws')}/sync`,
    account.tokens,
    {
      onUpdates: (message, at) => {
        void sim.doc.importRemote(message.bytes, message.head).match(
          () => undefined,
          () => {
            counters.errors++
          },
        )

        if (message.snapshot) snapshot?.()
        else book.received(message.head, at)
      },
      onAck: (message, at) => {
        book.acked(sim.label, message.batch, message.head, at)

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
      onError: () => {
        counters.errors++
      },
      onClose: () => {
        if (!run.closing) counters.closes++
      },
    },
  )

  sim.device = device
  device.subscribe(region)
  await snapshotted

  return sim
}

/** Appends one note to the sim's region and pushes it. */
async function write(run: Run, sim: Sim): Promise<void> {
  const created = await noteCreate(sim.doc, {
    id: noteIdFactory.create(),
    author: sim.account.identity.id,
    text: `note ${sim.batch + 1} from ${sim.label} at ${new Date().toISOString()}`,
  })

  created.match(
    (update) => {
      run.book.pushed(sim.label, ++sim.batch, performance.now())
      sim.device?.push(sim.region, sim.batch, update)
    },
    (error) => {
      run.counters.errors++
      console.error(`${sim.label}: ${error.code} ${error.message}`)
    },
  )
}

/** Writes a note after `delay` ms and again every `1000 / rate` ms while the run is writing. */
function scheduleWrite(run: Run, sim: Sim, delay: number): void {
  sim.timer = setTimeout(() => {
    if (!run.writing) return

    void write(run, sim)
    scheduleWrite(run, sim, 1000 / run.args.rate)
  }, delay)
}

/** Brings a step's new accounts, organisations and devices up; the first share are writers. */
async function addDevices(run: Run, step: Step): Promise<void> {
  const accounts = await signUp(run, step.add)
  const regions = await organise(run, accounts)
  const first = run.sims.length
  const added = await Promise.all(
    accounts.map((account, i) => openSim(run, account, regions[i] ?? fail('no region'), first + i)),
  )

  for (const sim of added.slice(0, Math.round(run.args.writers * added.length))) sim.writer = true

  run.sims.push(...added)
}

/** Lets every writer write for `hold` seconds; answers what the gateway used meanwhile. */
async function hold(run: Run, pid: number): Promise<{ rssMiB: number; cpuPercent: number }> {
  const before = procStats(pid)

  run.writing = true

  for (const sim of run.sims.filter((candidate) => candidate.writer)) {
    scheduleWrite(run, sim, Math.random() * (1000 / run.args.rate))
  }

  await sleep(run.args.hold * 1000)

  run.writing = false

  for (const sim of run.sims) clearTimeout(sim.timer)

  const after = procStats(pid)

  return {
    rssMiB: after.rssMiB,
    cpuPercent: ((after.cpuSeconds - before.cpuSeconds) / run.args.hold) * 100,
  }
}

/** Measures one step: its devices written to for the hold, then the latencies and stats. */
async function measure(run: Run, step: Step, pid: number): Promise<StepReport> {
  await addDevices(run, step)
  run.book.reset()
  resetCounters(run.counters)

  const gateway = await hold(run, pid)
  const surreal = await dockerStats(run.args.surrealContainer)
  const writers = run.sims.filter((sim) => sim.writer).length
  const ack = run.book.ackSamples()
  const fanout = run.book.fanoutSamples()
  const { errors, closes, asked, accepted, other } = run.counters
  const ackP95 = percentile(ack, 0.95)
  const fanoutP95 = percentile(fanout, 0.95)

  return {
    devices: run.sims.length,
    writers,
    offeredOpsPerS: writers * run.args.rate,
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
    degraded:
      ackP95 > ACK_P95_LIMIT_MS || fanoutP95 > FANOUT_P95_LIMIT_MS || errors > 0 || closes > 0,
  }
}

/** Runs the steps of the plan, printing a row per step; stops early on a degraded step if asked. */
async function runLoad(run: Run, pid: number): Promise<StepReport[]> {
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

/** Closes every device and stops the gateway child, waiting for its exit. */
async function teardown(run: Run, gateway: Bun.Subprocess): Promise<void> {
  run.closing = true
  run.writing = false

  for (const sim of run.sims) {
    clearTimeout(sim.timer)
    sim.device?.close()
  }

  gateway.kill('SIGTERM')
  await gateway.exited
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
    counters: { errors: 0, closes: 0, asked: 0, accepted: 0, other: 0 },
    sims: [],
    accounts: 0,
    organisations: 0,
    writing: false,
    closing: false,
  }

  console.log(`load ${id}: stand ${args.surrealUrl}, gateway on port ${args.gatewayPort}`)

  const gateway = await startGateway(args)
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
