/** How often a sampler reads its source's CPU time. */
export const CPU_SAMPLE_INTERVAL_MS = 250

/** A reading of a source's cumulative CPU time, with the `performance.now()` it was read at. */
export interface CpuSample {
  readonly at: number
  readonly cpuSeconds: number
}

/**
 * The CPU seconds a cgroup's `cpu.stat` (cgroup v2) reports in its `usage_usec` line: user and
 * system time of every process in it. `undefined` when the text has no such line.
 */
export function parseCpuStat(text: string): number | undefined {
  const usec = /^usage_usec (\d+)$/m.exec(text)?.[1]

  return usec === undefined ? undefined : Number(usec) / 1_000_000
}

/** The `cpu.stat` of a docker container's cgroup, where docker runs on cgroup v2 and systemd. */
export function cpuStatPath(containerId: string): string {
  if (!/^[0-9a-f]{64}$/.test(containerId)) throw new Error(`not a container id: ${containerId}`)

  return `/sys/fs/cgroup/system.slice/docker-${containerId}.scope/cpu.stat`
}

/**
 * The largest CPU use between two consecutive samples, in percent of one core: the CPU seconds
 * delta over the wall seconds delta, so a source on several cores may pass 100. `undefined` when
 * there is no pair of samples a wall time apart.
 */
export function peakCpuPercent(samples: readonly CpuSample[]): number | undefined {
  let peak: number | undefined

  for (let i = 1; i < samples.length; i++) {
    const [before, after] = [samples[i - 1], samples[i]]

    if (before === undefined || after === undefined || after.at <= before.at) continue

    const percent = ((after.cpuSeconds - before.cpuSeconds) / ((after.at - before.at) / 1000)) * 100

    peak = peak === undefined ? percent : Math.max(peak, percent)
  }

  return peak
}

/**
 * Reads `read` now and then every `intervalMs` until the returned function is called, which
 * reads once more and answers every sample in order; called again it answers the same samples.
 * A read that throws, because the source is gone, leaves no sample: the ones before it stand.
 */
export function sampleCpu(
  read: () => number,
  intervalMs: number = CPU_SAMPLE_INTERVAL_MS,
): () => CpuSample[] {
  const samples: CpuSample[] = []
  const take = (): void => {
    try {
      samples.push({ at: performance.now(), cpuSeconds: read() })
    } catch {
      // The source is gone: its last samples stand, and the step's own reads say what failed.
    }
  }
  const timer = setInterval(take, intervalMs)
  let stopped = false

  take()

  return () => {
    if (!stopped) {
      stopped = true
      clearInterval(timer)
      take()
    }

    return samples
  }
}
