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
