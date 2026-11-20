import { describe, expect, it } from 'vitest'

import {
  formatRestartRow,
  RESTART_HEADER,
  type RestartMeasure,
  type RestartReport,
  restartReport,
} from './restart-report'

describe('restartReport', () => {
  const measure: RestartMeasure = {
    devices: 20,
    stoppedAt: 10_000,
    healthyAt: 12_400,
    lastWelcomeAt: 15_000,
    failedHellos: 12,
    gatewayCpu: [
      { at: 11_000, cpuSeconds: 0 },
      { at: 11_250, cpuSeconds: 0.25 },
      { at: 11_500, cpuSeconds: 0.5 },
    ],
    surrealCpu: [
      { at: 10_000, cpuSeconds: 3 },
      { at: 10_500, cpuSeconds: 3.5 },
    ],
    gatewayRssMiB: 180.55,
    notBack: 0,
    ended: 0,
  }

  it('turns the instants into seconds from the stop and from the health answer', () => {
    expect(restartReport(measure)).toMatchObject({
      devices: 20,
      backS: 5,
      afterHealthS: 2.6,
      downS: 2.4,
      failedHellos: 12,
      gatewayRssMiB: 180.55,
      notBack: 0,
      ended: 0,
      degraded: false,
    })
  })

  it('reads the peaks of the CPU samples', () => {
    const report = restartReport(measure)

    expect(report.gatewayCpuPeakPercent).toBeCloseTo(100, 6)
    expect(report.surrealCpuPeakPercent).toBeCloseTo(100, 6)
  })

  it('leaves the surreal peak out when its CPU was not read, and the gateway one NaN', () => {
    const report = restartReport({ ...measure, surrealCpu: [], gatewayCpu: [] })

    expect('surrealCpuPeakPercent' in report).toBe(false)
    expect(report.gatewayCpuPeakPercent).toBeNaN()
  })

  it('has no back time when no device came back, and is degraded', () => {
    const report = restartReport({ ...measure, lastWelcomeAt: undefined, notBack: 20 })

    expect(report.backS).toBeNaN()
    expect(report.afterHealthS).toBeNaN()
    expect(report.degraded).toBe(true)
  })

  it('is degraded by a device that was ended, though all the others are back', () => {
    expect(restartReport({ ...measure, ended: 1 }).degraded).toBe(true)
  })

  it('never reports a negative time after health', () => {
    expect(restartReport({ ...measure, lastWelcomeAt: 12_350 }).afterHealthS).toBe(0)
  })
})

describe('formatRestartRow', () => {
  const report: RestartReport = {
    devices: 20,
    backS: 5,
    afterHealthS: 2.56,
    downS: 2.4,
    failedHellos: 12,
    gatewayCpuPeakPercent: 104.44,
    surrealCpuPeakPercent: 31.24,
    gatewayRssMiB: 180.5,
    notBack: 1,
    ended: 0,
    degraded: true,
  }

  it('prints one line with a cell under each header column', () => {
    const row = formatRestartRow(report)

    expect(row.includes('\n')).toBe(false)
    expect(row.length).toBe(RESTART_HEADER.length)
    expect(RESTART_HEADER).toContain('after health s')
    expect(RESTART_HEADER).toContain('surreal CPU peak %')
    expect(row.trim().split(/\s{2,}/)).toEqual([
      '20',
      '5.0',
      '2.6',
      '2.4',
      '12',
      '104.4',
      '31.2',
      '180.5',
      '1',
      '0',
      'yes',
    ])
  })

  it('prints a dash for the absent surreal peak and for times of a device that never came back', () => {
    const { surrealCpuPeakPercent: _peak, ...withoutSurreal } = report
    const row = formatRestartRow({
      ...withoutSurreal,
      backS: Number.NaN,
      afterHealthS: Number.NaN,
      degraded: false,
    })

    expect(row.trim().split(/\s{2,}/)).toEqual([
      '20',
      '-',
      '-',
      '2.4',
      '12',
      '104.4',
      '-',
      '180.5',
      '1',
      '0',
      'no',
    ])
  })
})
