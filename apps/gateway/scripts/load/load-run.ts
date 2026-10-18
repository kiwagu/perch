/**
 * The run of the gateway load test behind `ws-clients.ts`: simulated devices drive a gateway
 * this process starts as a child, in front of a SurrealDB stand, in steps of growing device
 * counts. Each step prints one table row of latency, memory and CPU (see `metrics.ts`).
 * `ack` is the time from a push to its ack; `fanout` is the time from a push to the arrival
 * of its update at another device of the organisation, before the device imports it (the
 * import is the replica's own measure). `ops/s` is nominal, writers times the rate; `pushes`
 * is what was pushed. After the hold the step drains for up to 5 s: `unacked` pushes lack an
 * ack, `undelivered` counts the deliveries still missing to the region's other live devices.
 * Either one, an error, a close, a silent step or a fan-out without samples is degraded. The accounts and
 * organisations it signs up stay on the stand, for the sweep of `@example.test` accounts.
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
const PARALLEL = 20
const STOP_GRACE_MS = 5_000
const SNAPSHOT_TIMEOUT_MS = 30_000
const HANDSHAKE_TIMEOUT_MS = 30_000
const DRAIN_TIMEOUT_MS = 5_000
const DRAIN_POLL_MS = 100
const SIGNAL_EXIT = 130
const ACK_P95_LIMIT_MS = 1_000
const FANOUT_P95_LIMIT_MS = 2_000

/** One simulated device: its socket, its copy of the organisation's region and its batches. */
interface Sim {
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

/** What the devices count during a step, besides the latencies. */
interface Counters {
  errors: number
  closes: number
  asked: number
  accepted: number
  other: number
  /** The reason and detail of the first reject of the step, to tell once. */
  firstReject: string | undefined
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
  /** Live (open, not retired) devices per region. */
  readonly live: Map<string, number>
  accounts: number
  /** Devices whose open was attempted; the labels count them. */
  attempted: number
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
  counters.firstReject = undefined
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

/** Whether something answers `/health` of `args.gatewayPort` with 200. */
async function healthy(args: LoadArgs): Promise<boolean> {
  return fetch(`http://127.0.0.1:${args.gatewayPort}/health`, {
    signal: AbortSignal.timeout(2000),
  }).then(
    (response) => response.status === 200,
    () => false,
  )
}

/** Starts the gateway as a child process and waits for its health to answer 200. */
async function startGateway(
  args: LoadArgs,
  onSpawn: (child: Bun.Subprocess) => void,
): Promise<Bun.Subprocess<'ignore', 'ignore', 'inherit'>> {
  if (await healthy(args)) {
    fail(`port ${args.gatewayPort} already answers /health: a stale gateway? stop it first`)
  }

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

  onSpawn(gateway)

  const deadline = Date.now() + HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (gateway.exitCode !== null) fail(`the gateway exited with ${gateway.exitCode}`)

    if (await healthy(args)) return gateway

    await sleep(250)
  }

  gateway.kill('SIGTERM')

  return fail(`the gateway did not answer /health within ${HEALTH_TIMEOUT_MS / 1000} s`)
}

/** Maps `items` with `work`, `PARALLEL` at a time, answering the results in order. */
async function inParallel<T, R>(
  items: readonly T[],
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = []

  for (let from = 0; from < items.length; from += PARALLEL) {
    const chunk = items.slice(from, from + PARALLEL)

    results.push(...(await Promise.all(chunk.map((item, i) => work(item, from + i)))))
  }

  return results
}

/** Signs up `count` new accounts, numbered from `run.accounts`. */
async function signUp(run: Run, count: number): Promise<SignedIn[]> {
  const first = run.accounts
  const signedUp = await inParallel(Array.from({ length: count }), (_, i) =>
    postCredentials(run.base, '/auth/sign-up', {
      email: `load-${run.id}-${first + i}@example.test`,
      password: run.password,
    }),
  )

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
      account.tokens,
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
      { timeoutMs: HANDSHAKE_TIMEOUT_MS },
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
function scheduleWrite(run: Run, sim: Sim, delay: number): void {
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
async function addDevices(run: Run, step: Step): Promise<void> {
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
function liveSims(run: Run): Sim[] {
  return run.sims.filter((sim) => !sim.retired)
}

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

/** Closes every device and stops the gateway child: SIGTERM, then SIGKILL after 5 s. */
async function teardown(run: Run, gateway: Bun.Subprocess | undefined): Promise<void> {
  run.closing = true
  run.writing = false

  for (const sim of run.sims) {
    clearTimeout(sim.timer)
    sim.device?.close()
  }

  if (!gateway) return

  gateway.kill('SIGTERM')

  const killer = setTimeout(() => gateway.kill('SIGKILL'), STOP_GRACE_MS)

  await gateway.exited
  clearTimeout(killer)
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
