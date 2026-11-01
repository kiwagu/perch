import { describe, expect, it } from 'vitest'

import { formatRow, type StepReport, TABLE_HEADER } from './report'

describe('formatRow', () => {
  const report: StepReport = {
    devices: 500,
    writers: 150,
    offeredOpsPerS: 15,
    pushes: 880,
    ackP50: 12.34,
    ackP95: 40,
    fanoutP50: 20,
    fanoutP95: 88.88,
    fanoutSamples: 4200,
    gatewayRssMiB: 210.5,
    gatewayCpuPercent: 35.2,
    surreal: { cpuPercent: 80.1, memMiB: 640 },
    compactions: { asked: 10, accepted: 8, other: 2 },
    errors: 0,
    closes: 1,
    unacked: 2,
    undelivered: 30,
    degraded: false,
  }

  it('prints one line with a cell under each header column', () => {
    const row = formatRow(report)

    expect(row.includes('\n')).toBe(false)
    expect(row.length).toBe(TABLE_HEADER.length)
    expect(row).toContain('12.3/40.0')
    expect(row).toContain('20.0/88.9 (4200)')
    expect(row).toContain('80.1 / 640.0')
    expect(row).toContain('10/8')
    expect(row).toContain('880')
  })

  it('prints a dash for the absent surreal stats', () => {
    const { surreal: _surreal, ...withoutSurreal } = report

    const cell = '-'.padEnd('surreal CPU % / MiB'.length)

    expect(formatRow(withoutSurreal)).toContain(`  ${cell}  `)
    expect(TABLE_HEADER).toContain('unacked')
    expect(TABLE_HEADER).toContain('undelivered')
    expect(TABLE_HEADER).toContain('pushes')
  })
})
