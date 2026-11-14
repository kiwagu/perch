import { describe, expect, it } from 'vitest'

import { cpuStatPath, parseCpuStat, peakCpuPercent, sampleCpu } from './cpu-sampler'

describe('parseCpuStat', () => {
  it('reads the usage line of a cgroup v2 cpu.stat in seconds', () => {
    const text = [
      'usage_usec 3169784',
      'user_usec 2247173',
      'system_usec 922611',
      'nice_usec 0',
      'nr_periods 0',
    ].join('\n')

    expect(parseCpuStat(text)).toBeCloseTo(3.169784, 6)
  })

  it('does not take another line for the usage line', () => {
    expect(parseCpuStat('user_usec 5\nsystem_usec 7\n')).toBeUndefined()
    expect(parseCpuStat('')).toBeUndefined()
    expect(parseCpuStat('usage_usec soon')).toBeUndefined()
  })
})

describe('cpuStatPath', () => {
  const id = 'a980b19f99aaf56595b6761c48e47ecc487d6f7c39956aacc5a1a93b35f201f4'

  it('names the cgroup of a container by its full id', () => {
    expect(cpuStatPath(id)).toBe(`/sys/fs/cgroup/system.slice/docker-${id}.scope/cpu.stat`)
  })

  it('refuses what is not a container id', () => {
    expect(() => cpuStatPath('../../etc')).toThrow('not a container id')
    expect(() => cpuStatPath('a980b19f')).toThrow('not a container id')
  })
})

describe('peakCpuPercent', () => {
  it('is the largest CPU seconds delta over wall seconds delta, in percent', () => {
    const samples = [
      { at: 0, cpuSeconds: 1 },
      { at: 250, cpuSeconds: 1.025 },
      { at: 500, cpuSeconds: 1.525 },
      { at: 750, cpuSeconds: 1.55 },
    ]

    expect(peakCpuPercent(samples)).toBeCloseTo(200, 6)
  })

  it('may pass 100 on several cores and may be 0 for a source that did not run', () => {
    expect(
      peakCpuPercent([
        { at: 1000, cpuSeconds: 0 },
        { at: 1500, cpuSeconds: 1.5 },
      ]),
    ).toBeCloseTo(300, 6)
    expect(
      peakCpuPercent([
        { at: 0, cpuSeconds: 2 },
        { at: 250, cpuSeconds: 2 },
      ]),
    ).toBe(0)
  })

  it('has no peak without two samples a wall time apart', () => {
    expect(peakCpuPercent([])).toBeUndefined()
    expect(peakCpuPercent([{ at: 0, cpuSeconds: 1 }])).toBeUndefined()
    expect(
      peakCpuPercent([
        { at: 5, cpuSeconds: 1 },
        { at: 5, cpuSeconds: 2 },
      ]),
    ).toBeUndefined()
  })
})

describe('sampleCpu', () => {
  it('reads at once, on every interval and at its stop, in order', async () => {
    let reads = 0
    const stop = sampleCpu(() => ++reads, 5)

    await new Promise((done) => setTimeout(done, 40))

    const samples = stop()

    expect(samples.length).toBeGreaterThanOrEqual(3)
    expect(samples[0]?.cpuSeconds).toBe(1)
    expect(samples.map((sample) => sample.cpuSeconds)).toEqual(samples.map((_, i) => i + 1))
    expect(samples.every((sample, i) => i === 0 || sample.at >= (samples[i - 1]?.at ?? 0))).toBe(
      true,
    )

    await new Promise((done) => setTimeout(done, 20))

    expect(reads).toBe(samples.length)
  })

  it('skips a read of a source that is gone', () => {
    let calls = 0
    const stop = sampleCpu(() => {
      if (++calls > 1) throw new Error('gone')

      return 7
    }, 1000)

    expect(stop().map((sample) => sample.cpuSeconds)).toEqual([7])
  })

  it('answers the same samples when stopped again, and reads no more', () => {
    let reads = 0
    const stop = sampleCpu(() => ++reads, 1000)
    const samples = stop()

    expect(stop()).toBe(samples)
    expect(samples).toHaveLength(2)
    expect(reads).toBe(2)
  })
})
