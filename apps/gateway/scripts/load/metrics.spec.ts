import { describe, expect, it } from 'vitest'

import {
  formatRow,
  LatencyBook,
  parseArgs,
  parseDockerStats,
  percentile,
  type StepReport,
  stepPlan,
  TABLE_HEADER,
} from './metrics'

describe('percentile', () => {
  it('takes the nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5)
    expect(Number.isNaN(percentile([], 0.5))).toBe(true)
  })
})

describe('stepPlan', () => {
  it('adds devices step by step and refuses a list that does not grow', () => {
    expect(stepPlan([100, 500, 1000])).toEqual([
      { total: 100, add: 100 },
      { total: 500, add: 400 },
      { total: 1000, add: 500 },
    ])
    expect(() => stepPlan([500, 100])).toThrow('devices must grow')
    expect(() => stepPlan([])).toThrow('devices must grow')
  })
})

describe('LatencyBook', () => {
  it('measures a push to its ack and to each reader that received its head', () => {
    const book = new LatencyBook()

    book.pushed('w1', 1, 1000)
    book.acked('w1', 1, 7, 1040)
    book.received(7, 1055)
    book.received(7, 1070)
    book.received(99, 2000)

    expect(book.ackSamples()).toEqual([40])
    expect(book.fanoutSamples()).toEqual([55, 70])
    book.reset()
    expect(book.ackSamples()).toEqual([])
  })
})

describe('parseArgs', () => {
  const env = { SURREAL_URL: 'http://127.0.0.1:8010' }

  it('reads the steps and the profile with their defaults', () => {
    expect(parseArgs(['--devices', '100,500', '--hold', '30'], env)).toMatchObject({
      devices: [100, 500],
      members: 20,
      writers: 0.3,
      rate: 0.1,
      hold: 30,
      gatewayPort: 5197,
      surrealUrl: 'http://127.0.0.1:8010',
      surrealContainer: 'perch-surrealdb-e2e',
      gatewayUser: 'gateway',
      stopOnDegrade: false,
    })
  })

  it('refuses a missing stand address', () => {
    expect(() => parseArgs([], {})).toThrow('SURREAL_URL')
  })

  it('refuses a flag value that is not a number, naming the flag', () => {
    expect(() => parseArgs(['--hold', 'soon'], env)).toThrow('--hold')
  })

  it('reads the stop flag and the report path', () => {
    expect(parseArgs(['--stop-on-degrade', '--json', 'out.json'], env)).toMatchObject({
      stopOnDegrade: true,
      json: 'out.json',
    })
  })
})

describe('parseDockerStats', () => {
  it('reads cpu percent and memory in MiB whatever the unit', () => {
    expect(parseDockerStats('12.34% 123.4MiB / 7.6GiB')).toEqual({
      cpuPercent: 12.34,
      memMiB: 123.4,
    })
    expect(parseDockerStats('0.5% 1.5GiB / 7.6GiB')).toEqual({ cpuPercent: 0.5, memMiB: 1536 })
    expect(parseDockerStats('0.5% 2048KiB / 7.6GiB')).toEqual({ cpuPercent: 0.5, memMiB: 2 })
    expect(parseDockerStats('garbage')).toBeUndefined()
  })
})

describe('formatRow', () => {
  const report: StepReport = {
    devices: 500,
    writers: 150,
    offeredOpsPerS: 15,
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
  })

  it('prints a dash for the absent surreal stats', () => {
    const { surreal: _surreal, ...withoutSurreal } = report

    expect(formatRow(withoutSurreal)).toContain(' -')
  })
})
