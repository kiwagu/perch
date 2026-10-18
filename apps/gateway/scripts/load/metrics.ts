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

/**
 * Latency samples in milliseconds: a push to its ack, and a push to each reader that received
 * its head. The head map outlives `reset` because readers receive heads past a step boundary.
 */
export class LatencyBook {
  readonly #pushedAt = new Map<string, number>()
  readonly #headPushedAt = new Map<number, number>()
  /** Receipts of heads whose ack has not arrived yet, which a reader can beat. */
  #early = new Map<number, number[]>()
  #ack: number[] = []
  #fanout: number[] = []

  pushed(device: string, batch: number, at: number): void {
    this.#pushedAt.set(`${device}#${batch}`, at)
  }

  acked(device: string, batch: number, head: number, at: number): void {
    const pushedAt = this.#pushedAt.get(`${device}#${batch}`)

    if (pushedAt === undefined) return
    this.#ack.push(at - pushedAt)
    this.#pushedAt.delete(`${device}#${batch}`)
    this.#headPushedAt.set(head, pushedAt)

    for (const receivedAt of this.#early.get(head) ?? []) this.#fanout.push(receivedAt - pushedAt)

    this.#early.delete(head)
  }

  /** A reader received `head`; a receipt before the head's ack waits for the ack. */
  received(head: number, at: number): void {
    const pushedAt = this.#headPushedAt.get(head)

    if (pushedAt !== undefined) this.#fanout.push(at - pushedAt)
    else this.#early.set(head, [...(this.#early.get(head) ?? []), at])
  }

  ackSamples(): number[] {
    return [...this.#ack]
  }

  fanoutSamples(): number[] {
    return [...this.#fanout]
  }

  reset(): void {
    this.#ack = []
    this.#fanout = []
    this.#early = new Map()
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
  surrealContainer: string
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
    surrealContainer: 'perch-surrealdb-e2e',
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
  degraded: boolean
}

const COLUMNS = [
  'devices',
  'writers',
  'ops/s',
  'ack p50/p95 ms',
  'fanout p50/p95 ms (n)',
  'gw RSS MiB',
  'gw CPU %',
  'surreal CPU % / MiB',
  'compactions asked/accepted',
  'errors',
  'closes',
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
    `${one(row.ackP50)}/${one(row.ackP95)}`,
    `${one(row.fanoutP50)}/${one(row.fanoutP95)} (${row.fanoutSamples})`,
    one(row.gatewayRssMiB),
    one(row.gatewayCpuPercent),
    row.surreal ? `${one(row.surreal.cpuPercent)} / ${one(row.surreal.memMiB)}` : '-',
    `${row.compactions.asked}/${row.compactions.accepted}`,
    String(row.errors),
    String(row.closes),
    row.degraded ? 'yes' : 'no',
  ])
}
