import { describe, expect, it } from 'vitest'

import { parseDockerStats, procStats } from './process-stats'

describe('procStats', () => {
  it('reads memory and cpu time of a running process', () => {
    const stats = procStats(process.pid)

    expect(stats.rssMiB).toBeGreaterThan(0)
    expect(stats.cpuSeconds).toBeGreaterThanOrEqual(0)
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
