/**
 * Which of the Bun dev scripts a `bun run dev` starts, as turbo itself selects them: a dry run of
 * the very arguments it will run with (`--exclude`, `-x`, and any `--filter` after `--`, patterns
 * and all) names the tasks it would run, so the preflight and the stand operator follow turbo's own
 * reading of its filters instead of a second one.
 */

import { z } from '@workspace/zod'

import { jsonOf, run } from './json-command.ts'
import type { DevScript } from './mcproc.ts'

/** The workspace of each dev script the preflight is about. */
export const DEV_WORKSPACES: Readonly<Record<DevScript, string>> = {
  gateway: '@workspace/gateway',
  web: '@workspace/web',
}

/** The command turbo gives a task of a workspace that has no such script: it runs nothing. */
const NO_SCRIPT = '<NONEXISTENT>'

const drySchema = z.object({
  tasks: z.array(z.object({ package: z.string(), command: z.string() })),
})

/** Which dev scripts the tasks of turbo's dry run (`--dry=json`) start. */
export function selectedScripts(
  json: unknown,
): { runs: Readonly<Record<DevScript, boolean>> } | { problems: string[] } {
  const parsed = drySchema.safeParse(json)

  if (!parsed.success) {
    return {
      problems: parsed.error.issues.map(
        (issue) =>
          `turbo's dry run printed what bun run dev cannot read at ${issue.path.join('.')}`,
      ),
    }
  }

  const starts = (workspace: string): boolean =>
    parsed.data.tasks.some((task) => task.package === workspace && task.command !== NO_SCRIPT)

  return { runs: { gateway: starts(DEV_WORKSPACES.gateway), web: starts(DEV_WORKSPACES.web) } }
}

/** turbo's arguments for a dry run of `args` (`run <task> ...`), which prints its tasks as JSON. */
export const dryRunArgs = (args: readonly string[]): string[] => [
  ...args.slice(0, 2),
  '--dry=json',
  ...args.slice(2),
]

/** Runs turbo dry with `args` from `root`, on the PATH of `env`: its JSON, or why there is none. */
export function turboDryRun(
  root: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): { json: unknown } | string {
  const turbo = Bun.which('turbo', { PATH: env['PATH'] ?? '' })

  if (turbo === null) {
    return 'turbo is not on PATH: run bun install at the repository root'
  }

  return jsonOf(
    `turbo ${dryRunArgs(args).join(' ')}`,
    run(turbo, dryRunArgs(args), root, env),
    'run bun install at the repository root',
  )
}
