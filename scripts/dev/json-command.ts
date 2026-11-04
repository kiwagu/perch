/**
 * The JSON a command prints, for the tools `bun run dev` asks (mcproc, turbo). A command that
 * fails is reported by its exit, never by its output: mcproc's errors quote the manifest's values
 * as it resolved them, the stands' auth secret among them, and the terminal of `bun run dev` is
 * no place for them.
 */

import { spawnSync } from 'node:child_process'

/** What a finished command left behind, as `spawnSync` gives it. */
export type Ran = {
  error?: Error | undefined
  status: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
}

const codeOf = (error: Error): string =>
  'code' in error && typeof error.code === 'string' ? error.code : error.name

/**
 * The JSON `command` printed, or why there is none: it could not start (`unstartable` says what
 * to do), it failed, or it printed something else. Never a word of what it printed.
 */
export function jsonOf(command: string, ran: Ran, unstartable: string): { json: unknown } | string {
  if (ran.error) {
    return `${command} could not run (${codeOf(ran.error)}): ${unstartable}`
  }

  if (ran.status !== 0) {
    const exit =
      ran.status === null
        ? `was stopped by ${ran.signal ?? 'a signal'}`
        : `failed with exit code ${ran.status}`

    return `${command} ${exit}; run it yourself to see why (bun run dev repeats none of its output, which may quote the stand's values)`
  }

  try {
    return { json: JSON.parse(ran.stdout) as unknown }
  } catch {
    return `${command} printed no JSON`
  }
}

/** Runs `program` with `args` from `cwd` and gives what it left behind. */
export function run(
  program: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Ran {
  return spawnSync(program, [...args], { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
