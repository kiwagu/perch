/**
 * The pure parts of the gateway load test: percentiles, the step plan, push-to-ack and
 * push-to-reader latency bookkeeping, argument parsing, process and container stats, and the
 * report table. `ws-clients.ts` drives the devices and prints one row per step with these.
 */

import { readFileSync } from 'node:fs'

/** Clock ticks per second that `/proc/<pid>/stat` counts CPU time in. */
const CLK_TCK = 100

/** The value below which `share` of the samples fall (nearest rank); `NaN` for no samples. */
export function percentile(samples: readonly number[], share: number): number {
  const sorted = [...samples].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil(share * sorted.length))

  return sorted[rank - 1] ?? Number.NaN
}

/** How many devices a step holds in all and how many it adds to the step before. */
export interface Step {
  readonly total: number
  readonly add: number
}

/** The steps of a ramp: each device count must be larger than the one before it. */
export function stepPlan(devices: readonly number[]): readonly Step[] {
  if (devices.length === 0 || devices.some((total, i) => total <= (devices[i - 1] ?? 0))) {
    throw new Error('devices must grow')
  }

  return devices.map((total, i) => ({ total, add: total - (devices[i - 1] ?? 0) }))
}

/** One push as the book follows it: its epoch, when it left, and what came of it. */
interface Push {
  readonly epoch: number
  readonly at: number
  /** How many other devices of its region were live when it left. */
  readonly expected: number
  delivered: number
  acked: boolean
  headKey: string | undefined
}

interface Epoch {
  ack: number[]
  fanout: number[]
  readonly pushes: Push[]
}

/** What an epoch measured, once its pushes had their time to be acked and delivered. */
export interface EpochResult {
  ack: number[]
  fanout: number[]
  pushes: number
  /** Deliveries the epoch's pushes should have made to other devices. */
  expected: number
  /** Pushes without an ack. */
  unacked: number
  /** Deliveries missing for the acked pushes. */
  undelivered: number
}

/**
 * Latency samples in milliseconds: a push to its ack, and a push to each other device that
 * received its head. Every push belongs to the epoch that was current when it left, and its
 * ack and deliveries count there however late they come, so a step's numbers account for
 * every push of the step. A receipt that beats its ack waits for it.
 */
export class LatencyBook {
  readonly #pushes = new Map<string, Push>()
  /** Keyed by region and head: every region counts its heads from 1. */
  readonly #byHead = new Map<string, Push>()
  readonly #early = new Map<string, number[]>()
  readonly #epochs = new Map<number, Epoch>()
  #current = 0

  /** Opens a new epoch, which the pushes from now on belong to. */
  startEpoch(): number {
    this.#current++
    this.#epochs.set(this.#current, { ack: [], fanout: [], pushes: [] })

    return this.#current
  }

  pushed(device: string, batch: number, region: string, at: number, expected: number): void {
    const epoch = this.#epochs.get(this.#current)

    if (!epoch) throw new Error('no epoch started')

    const push: Push = {
      epoch: this.#current,
      at,
      expected,
      delivered: 0,
      acked: false,
      headKey: undefined,
    }

    this.#pushes.set(`${device}#${batch}#${region}`, push)
    epoch.pushes.push(push)
  }

  acked(device: string, batch: number, region: string, head: number, at: number): void {
    const id = `${device}#${batch}#${region}`
    const push = this.#pushes.get(id)

    if (push === undefined) return

    const key = `${region}#${head}`

    push.acked = true
    push.headKey = key
    this.#epochs.get(push.epoch)?.ack.push(at - push.at)
    this.#pushes.delete(id)
    this.#byHead.set(key, push)

    for (const receivedAt of this.#early.get(key) ?? []) this.#delivered(push, receivedAt)

    this.#early.delete(key)
  }

  /** A device received `head` of `region`; a receipt before the head's ack waits for the ack. */
  received(region: string, head: number, at: number): void {
    const key = `${region}#${head}`
    const push = this.#byHead.get(key)

    if (push !== undefined) this.#delivered(push, at)
    else this.#early.set(key, [...(this.#early.get(key) ?? []), at])
  }

  /** What the epoch's pushes still lack: an ack, or deliveries to other devices. */
  status(epoch: number): { unacked: number; undelivered: number } {
    let unacked = 0
    let undelivered = 0

    for (const push of this.#epochs.get(epoch)?.pushes ?? []) {
      if (!push.acked) unacked++
      else undelivered += Math.max(0, push.expected - push.delivered)
    }

    return { unacked, undelivered }
  }

  /** The epoch's samples and counts; the epoch is forgotten, a later arrival for it ignored. */
  finalize(epoch: number): EpochResult {
    const found = this.#epochs.get(epoch)
    const pushes = found?.pushes ?? []
    const result: EpochResult = {
      ack: found?.ack ?? [],
      fanout: found?.fanout ?? [],
      pushes: pushes.length,
      expected: pushes.reduce((sum, push) => sum + push.expected, 0),
      ...this.status(epoch),
    }

    for (const push of pushes) {
      if (push.headKey !== undefined) this.#byHead.delete(push.headKey)
    }

    for (const [id, push] of this.#pushes) {
      if (push.epoch === epoch) this.#pushes.delete(id)
    }

    this.#epochs.delete(epoch)

    return result
  }

  #delivered(push: Push, at: number): void {
    push.delivered++
    this.#epochs.get(push.epoch)?.fanout.push(at - push.at)
  }
}

/** The profile and the stand of one load run. */
export interface LoadArgs {
  devices: number[]
  members: number
  writers: number
  rate: number
  hold: number
  gatewayPort: number
  surrealUrl: string
  /** The stand's docker container; `undefined` when it is not known, which skips its stats. */
  surrealContainer: string | undefined
  gatewayUser: string
  gatewayPass: string
  json?: string
  stopOnDegrade: boolean
}

function numberFlag(flag: string, value: string | undefined): number {
  const parsed = Number(value)

  if (value === undefined || value.trim() === '' || !Number.isFinite(parsed)) {
    throw new Error(`${flag} needs a number, got ${value === undefined ? 'nothing' : `"${value}"`}`)
  }

  return parsed
}

/** The port of the e2e stand of the main checkout; worktree slots shift it by 100 each. */
const E2E_PORT = 8010
const SLOT_PORT_STEP = 100

/**
 * The docker container of the e2e stand at `surrealUrl`: `perch-surrealdb-e2e` on port 8010,
 * `perch-w<slot>-surrealdb-e2e` on 8010 plus 100 per slot, none on any other port.
 */
export function standContainer(surrealUrl: string): string | undefined {
  const port = URL.canParse(surrealUrl) ? Number(new URL(surrealUrl).port) : Number.NaN
  const slot = (port - E2E_PORT) / SLOT_PORT_STEP

  if (!Number.isInteger(slot) || slot < 0) return undefined

  return slot === 0 ? 'perch-surrealdb-e2e' : `perch-w${slot}-surrealdb-e2e`
}

function checked(flag: string, ok: boolean, domain: string): void {
  if (!ok) throw new Error(`${flag} must be ${domain}`)
}

/** Refuses values outside the domains the run can work with, naming the flag. */
function checkDomains(args: LoadArgs): void {
  checked(
    '--devices',
    args.devices.every(
      (total, i) => Number.isInteger(total) && total > 0 && total > (args.devices[i - 1] ?? 0),
    ),
    'positive integers, each larger than the one before',
  )
  checked('--members', Number.isInteger(args.members) && args.members > 0, 'a positive integer')
  checked('--writers', args.writers >= 0 && args.writers <= 1, 'between 0 and 1')
  checked('--rate', args.rate > 0, 'above 0')
  checked('--hold', args.hold > 0, 'above 0')
  checked(
    '--gateway-port',
    Number.isInteger(args.gatewayPort) && args.gatewayPort >= 1 && args.gatewayPort <= 65535,
    'an integer from 1 to 65535',
  )
}

/** Reads the run's flags over their defaults; the stand address comes from `SURREAL_URL`. */
export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): LoadArgs {
  const surrealUrl = env['SURREAL_URL']

  if (!surrealUrl) throw new Error('SURREAL_URL is required: run through mcproc exec or set it')

  const args: LoadArgs = {
    devices: [100, 500, 1000, 2000],
    members: 20,
    writers: 0.3,
    rate: 0.1,
    hold: 60,
    gatewayPort: 5197,
    surrealUrl,
    surrealContainer: standContainer(surrealUrl),
    gatewayUser: env['GATEWAY_SURREAL_USER'] ?? 'gateway',
    gatewayPass: env['GATEWAY_SURREAL_PASS'] ?? 'gateway-stand-password',
    stopOnDegrade: false,
  }

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i] ?? ''

    if (flag === '--stop-on-degrade') {
      args.stopOnDegrade = true
      continue
    }

    const value = argv[++i]

    switch (flag) {
      case '--devices':
        args.devices = (value ?? '').split(',').map((part) => numberFlag(flag, part))
        break
      case '--members':
        args.members = numberFlag(flag, value)
        break
      case '--writers':
        args.writers = numberFlag(flag, value)
        break
      case '--rate':
        args.rate = numberFlag(flag, value)
        break
      case '--hold':
        args.hold = numberFlag(flag, value)
        break
      case '--gateway-port':
        args.gatewayPort = numberFlag(flag, value)
        break
      case '--surreal-container':
        if (value === undefined) throw new Error('--surreal-container needs a name')
        args.surrealContainer = value
        break
      case '--json':
        if (value === undefined) throw new Error('--json needs a path')
        args.json = value
        break
      default:
        throw new Error(`unknown flag ${flag}`)
    }
  }

  checkDomains(args)

  return args
}

/** Resident memory and CPU time of a process, read from `/proc`; throws when it is gone. */
export function procStats(pid: number): { rssMiB: number; cpuSeconds: number } {
  const status = readFileSync(`/proc/${pid}/status`, 'utf8')
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
  const rssKiB = /VmRSS:\s+(\d+) kB/.exec(status)?.[1]
  // The command name may hold spaces, so the fields count from the last closing parenthesis;
  // utime and stime are fields 14 and 15 of the stat line, 11 and 12 after the state field.
  const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
  const ticks = Number(fields[11]) + Number(fields[12])

  if (rssKiB === undefined || !Number.isFinite(ticks))
    throw new Error(`cannot read stats of ${pid}`)

  return { rssMiB: Math.round((Number(rssKiB) / 1024) * 10) / 10, cpuSeconds: ticks / CLK_TCK }
}

/** Reads `12.34% 123.4MiB / 7.6GiB` as CPU percent and used memory in MiB. */
export function parseDockerStats(text: string): { cpuPercent: number; memMiB: number } | undefined {
  const match = /^([\d.]+)%\s+([\d.]+)\s*(GiB|MiB|KiB|kB|B)\b/.exec(text.trim())

  if (!match) return undefined

  const unitToMiB = { GiB: 1024, MiB: 1, KiB: 1 / 1024, kB: 1 / 1024, B: 1 / 1024 / 1024 }

  return {
    cpuPercent: Number(match[1]),
    memMiB: Number(match[2]) * unitToMiB[match[3] as keyof typeof unitToMiB],
  }
}

/** CPU and memory of a container from `docker stats`; `undefined` when docker cannot say. */
export async function dockerStats(
  container: string,
): Promise<{ cpuPercent: number; memMiB: number } | undefined> {
  const proc = Bun.spawn(
    ['docker', 'stats', '--no-stream', '--format', '{{.CPUPerc}} {{.MemUsage}}', container],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])

  return code === 0 ? parseDockerStats(out) : undefined
}

/** What one step measured. */
export interface StepReport {
  devices: number
  writers: number
  offeredOpsPerS: number
  /** Pushes made during the step. */
  pushes: number
  ackP50: number
  ackP95: number
  fanoutP50: number
  fanoutP95: number
  fanoutSamples: number
  gatewayRssMiB: number
  gatewayCpuPercent: number
  surreal?: { cpuPercent: number; memMiB: number }
  compactions: { asked: number; accepted: number; other: number }
  errors: number
  closes: number
  unacked: number
  undelivered: number
  degraded: boolean
}

const COLUMNS = [
  'devices',
  'writers',
  'ops/s',
  'pushes',
  'ack p50/p95 ms',
  'fanout p50/p95 ms (n)',
  'gw RSS MiB',
  'gw CPU %',
  'surreal CPU % / MiB',
  'compactions asked/accepted',
  'errors',
  'closes',
  'unacked',
  'undelivered',
  'degraded',
] as const

const line = (cells: readonly string[]): string =>
  cells.map((cell, i) => cell.padEnd(COLUMNS[i]?.length ?? 0)).join('  ')

const one = (value: number): string => (Number.isNaN(value) ? '-' : value.toFixed(1))

/** The header line of the report table. */
export const TABLE_HEADER = line(COLUMNS)

/** One table line for a step, its cells as wide as their headers. */
export function formatRow(row: StepReport): string {
  return line([
    String(row.devices),
    String(row.writers),
    one(row.offeredOpsPerS),
    String(row.pushes),
    `${one(row.ackP50)}/${one(row.ackP95)}`,
    `${one(row.fanoutP50)}/${one(row.fanoutP95)} (${row.fanoutSamples})`,
    one(row.gatewayRssMiB),
    one(row.gatewayCpuPercent),
    row.surreal ? `${one(row.surreal.cpuPercent)} / ${one(row.surreal.memMiB)}` : '-',
    `${row.compactions.asked}/${row.compactions.accepted}`,
    String(row.errors),
    String(row.closes),
    String(row.unacked),
    String(row.undelivered),
    row.degraded ? 'yes' : 'no',
  ])
}
