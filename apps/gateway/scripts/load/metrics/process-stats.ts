import { readFileSync } from 'node:fs'

import { cpuStatPath, parseCpuStat } from './cpu-sampler'

/** Clock ticks per second that `/proc/<pid>/stat` counts CPU time in. */
const CLK_TCK = 100

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

/**
 * A reader of a container's CPU seconds, from its cgroup's `cpu.stat`; the container is looked
 * up in docker once. `undefined` when docker does not know the container or its cgroup cannot
 * be read (docker without cgroup v2 and systemd), which skips the container's CPU.
 */
export async function containerCpuReader(container: string): Promise<(() => number) | undefined> {
  const proc = Bun.spawn(['docker', 'inspect', '--format', '{{.Id}}', container], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])

  if (code !== 0) return undefined

  try {
    const path = cpuStatPath(out.trim())
    const read = (): number => {
      const seconds = parseCpuStat(readFileSync(path, 'utf8'))

      if (seconds === undefined) throw new Error(`no usage_usec in ${path}`)

      return seconds
    }

    read()

    return read
  } catch {
    return undefined
  }
}
