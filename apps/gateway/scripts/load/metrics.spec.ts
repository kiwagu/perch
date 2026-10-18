import { describe, expect, it } from 'vitest'

import {
  formatRow,
  LatencyBook,
  parseArgs,
  parseDockerStats,
  percentile,
  procStats,
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
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 2)
    book.acked('w1', 1, 'tenant:a', 7, 1040)
    book.received('tenant:a', 7, 1055)
    book.received('tenant:a', 7, 1070)
    book.received('tenant:a', 99, 2000)

    expect(book.finalize(epoch)).toEqual({
      ack: [40],
      fanout: [55, 70],
      pushes: 1,
      expected: 2,
      unacked: 0,
      undelivered: 0,
    })
  })

  it('keeps a receipt that lands before its ack: the same sample as one after', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 2)
    book.received('tenant:a', 7, 1020)
    book.acked('w1', 1, 'tenant:a', 7, 1040)
    book.received('tenant:a', 7, 1055)

    expect(book.finalize(epoch).fanout).toEqual([20, 55])
  })

  it('scopes a head to its region: two regions with one head number do not cross', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.pushed('w2', 1, 'tenant:b', 2000, 1)
    book.acked('w1', 1, 'tenant:a', 1, 1010)
    book.acked('w2', 1, 'tenant:b', 1, 2010)
    book.received('tenant:a', 1, 1030)
    book.received('tenant:b', 1, 2050)
    book.received('tenant:c', 1, 3000)

    expect(book.finalize(epoch).fanout).toEqual([30, 50])
  })

  it('attributes a late ack to the epoch of its push', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)

    const second = book.startEpoch()

    book.acked('w1', 1, 'tenant:a', 1, 1500)
    book.received('tenant:a', 1, 1600)

    expect(book.finalize(second)).toMatchObject({ ack: [], fanout: [], pushes: 0 })
    expect(book.finalize(first)).toMatchObject({ ack: [500], fanout: [600], pushes: 1 })
  })

  it('keeps an early receipt across an epoch change', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.received('tenant:a', 1, 1020)
    book.startEpoch()
    book.acked('w1', 1, 'tenant:a', 1, 1040)

    expect(book.finalize(first)).toMatchObject({ ack: [40], fanout: [20], undelivered: 0 })
  })

  it('drops the receipts of an unacked push when its epoch is finalized', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)
    book.received('tenant:a', 5, 1020)
    book.finalize(first)

    const second = book.startEpoch()

    book.pushed('w1', 2, 'tenant:a', 2000, 1)
    book.acked('w1', 2, 'tenant:a', 5, 2010)

    expect(book.finalize(second).fanout).toEqual([])
  })

  it('keeps the receipts of a region that still has an unacked push in a live epoch', () => {
    const book = new LatencyBook()
    const first = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 1)

    const second = book.startEpoch()

    book.pushed('w2', 1, 'tenant:a', 2000, 1)
    book.received('tenant:a', 5, 2020)
    book.finalize(first)
    book.acked('w2', 1, 'tenant:a', 5, 2030)

    expect(book.finalize(second).fanout).toEqual([20])
  })

  it('counts the pushes without an ack and the deliveries still missing', () => {
    const book = new LatencyBook()
    const epoch = book.startEpoch()

    book.pushed('w1', 1, 'tenant:a', 1000, 3)
    book.pushed('w1', 2, 'tenant:a', 1100, 3)
    book.pushed('w1', 3, 'tenant:a', 1200, 3)
    book.acked('w1', 1, 'tenant:a', 1, 1010)
    book.acked('w1', 2, 'tenant:a', 2, 1110)
    book.received('tenant:a', 1, 1020)
    book.received('tenant:a', 1, 1021)
    book.received('tenant:a', 1, 1022)
    book.received('tenant:a', 2, 1120)

    expect(book.status(epoch)).toEqual({ unacked: 1, undelivered: 2 })
    expect(book.finalize(epoch)).toMatchObject({
      pushes: 3,
      expected: 9,
      unacked: 1,
      undelivered: 2,
    })
  })
})

describe('procStats', () => {
  it('reads memory and cpu time of a running process', () => {
    const stats = procStats(process.pid)

    expect(stats.rssMiB).toBeGreaterThan(0)
    expect(stats.cpuSeconds).toBeGreaterThanOrEqual(0)
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

  it('refuses --surreal-container without a value, naming the flag', () => {
    expect(() => parseArgs(['--surreal-container'], env)).toThrow('--surreal-container')
  })

  it.each([
    [['--members', '0'], '--members'],
    [['--members', '2.5'], '--members'],
    [['--writers', '1.5'], '--writers'],
    [['--writers', '-0.1'], '--writers'],
    [['--rate', '0'], '--rate'],
    [['--hold', '0'], '--hold'],
    [['--gateway-port', '70000'], '--gateway-port'],
    [['--gateway-port', '80.5'], '--gateway-port'],
    [['--devices', '100,50'], '--devices'],
    [['--devices', '0,10'], '--devices'],
    [['--devices', '10,10.5'], '--devices'],
  ])('refuses %j, naming %s', (argv, flag) => {
    expect(() => parseArgs(argv, env)).toThrow(flag)
  })

  it('accepts the edges of the domains', () => {
    expect(
      parseArgs(['--writers', '0', '--devices', '1,2', '--gateway-port', '65535'], env),
    ).toMatchObject({ writers: 0, devices: [1, 2], gatewayPort: 65535 })
  })

  it('names the stand container by the slot of the stand port', () => {
    const named = (url: string) => parseArgs([], { SURREAL_URL: url }).surrealContainer

    expect(named('http://127.0.0.1:8010')).toBe('perch-surrealdb-e2e')
    expect(named('http://127.0.0.1:8110')).toBe('perch-w1-surrealdb-e2e')
    expect(named('http://127.0.0.1:8310')).toBe('perch-w3-surrealdb-e2e')
    expect(named('http://127.0.0.1:8000')).toBeUndefined()
    expect(named('http://127.0.0.1:8111')).toBeUndefined()
    expect(parseArgs(['--surreal-container', 'mine'], { SURREAL_URL: 'http://h:1' })).toMatchObject(
      {
        surrealContainer: 'mine',
      },
    )
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
