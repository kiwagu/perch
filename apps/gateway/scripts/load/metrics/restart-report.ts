import { type CpuSample, peakCpuPercent } from './cpu-sampler'
import { oneDecimal as one, tableLine } from './table'

/** What the restart step measured; its times are seconds, `NaN` for what never happened. */
export interface RestartReport {
  /** Devices live when the old gateway was stopped. */
  devices: number
  /** From the stop to the last welcome; `NaN` when no device came back. */
  backS: number
  /** From the new gateway's first 200 on `/health` to the last welcome; `NaN` as `backS`. */
  afterHealthS: number
  /** From the stop to the new gateway's first 200 on `/health`. */
  downS: number
  /** Opens of the reconnect loops that were rejected: refused, closed or not welcomed in time. */
  failedHellos: number
  gatewayCpuPeakPercent: number
  /** Absent when the stand container's CPU could not be read. */
  surrealCpuPeakPercent?: number
  gatewayRssMiB: number
  /** Devices not welcomed again when the step ended. */
  notBack: number
  /** Devices the gateway ended with a close that no reconnect follows. */
  ended: number
  degraded: boolean
}

/** The raw readings of the step: `performance.now()` instants, samples and counts. */
export interface RestartMeasure {
  devices: number
  /** The step stopped the old gateway. */
  stoppedAt: number
  /** The new gateway first answered `/health` with 200. */
  healthyAt: number
  /** The latest welcome of any device; `undefined` when there was none. */
  lastWelcomeAt: number | undefined
  failedHellos: number
  gatewayCpu: readonly CpuSample[]
  /** Empty when the stand container's CPU could not be read. */
  surrealCpu: readonly CpuSample[]
  gatewayRssMiB: number
  notBack: number
  ended: number
}

const seconds = (ms: number): number => ms / 1000

/**
 * The step's report from its readings. A welcome can land a poll before the health answer that
 * is seen first, so the time after health is never below 0. The step is degraded when a device
 * is not back or was ended.
 */
export function restartReport(measure: RestartMeasure): RestartReport {
  const { lastWelcomeAt, stoppedAt, healthyAt, notBack, ended } = measure
  const surrealPeak = peakCpuPercent(measure.surrealCpu)

  return {
    devices: measure.devices,
    backS: lastWelcomeAt === undefined ? Number.NaN : seconds(lastWelcomeAt - stoppedAt),
    afterHealthS:
      lastWelcomeAt === undefined ? Number.NaN : Math.max(0, seconds(lastWelcomeAt - healthyAt)),
    downS: seconds(healthyAt - stoppedAt),
    failedHellos: measure.failedHellos,
    gatewayCpuPeakPercent: peakCpuPercent(measure.gatewayCpu) ?? Number.NaN,
    ...(surrealPeak === undefined ? {} : { surrealCpuPeakPercent: surrealPeak }),
    gatewayRssMiB: measure.gatewayRssMiB,
    notBack,
    ended,
    degraded: notBack > 0 || ended > 0,
  }
}

const COLUMNS = [
  'devices',
  'back s',
  'after health s',
  'down s',
  'failed hellos',
  'gw CPU peak %',
  'surreal CPU peak %',
  'gw RSS MiB',
  'not back',
  'ended',
  'degraded',
] as const

const line = (cells: readonly string[]): string => tableLine(COLUMNS, cells)

/** The header line of the restart row. */
export const RESTART_HEADER = line(COLUMNS)

/** The restart row, its cells as wide as their headers. */
export function formatRestartRow(row: RestartReport): string {
  return line([
    String(row.devices),
    one(row.backS),
    one(row.afterHealthS),
    one(row.downS),
    String(row.failedHellos),
    one(row.gatewayCpuPeakPercent),
    row.surrealCpuPeakPercent === undefined ? '-' : one(row.surrealCpuPeakPercent),
    one(row.gatewayRssMiB),
    String(row.notBack),
    String(row.ended),
    row.degraded ? 'yes' : 'no',
  ])
}
