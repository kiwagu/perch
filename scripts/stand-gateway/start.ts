/**
 * The two steps a stand's gateway starts with, whoever starts it (`cli.ts` for the manifest's
 * gateway apps, `scripts/dev/cli.ts` for `bun run dev`): the stand operator defines the gateway's
 * user on the stand's SurrealDB, then this process becomes the command that runs the gateway, with
 * the gateway's settings in its environment. It replaces itself rather than waiting on a child, so
 * pm2 and the terminal hold the gateway (or turbo) itself: its signals, its exit code, its port.
 */

import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { operatorSettings, type Stand } from './settings.ts'

/** Runs the stand operator against the stand's SurrealDB as its root; gives its exit code. */
export function defineGatewayUser(stand: Stand, root: string): number {
  const result = spawnSync(process.execPath, [join(root, 'scripts', 'stand-operator.ts')], {
    // From the repository root, whose bunfig registers the `.surql` loader the operator needs.
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...operatorSettings(stand) },
  })

  if (result.error) {
    console.error(`the stand operator could not start: ${result.error.message}`)

    return 1
  }

  return result.status ?? 1
}

/**
 * Replaces this process with `command`, run with `env` (its program looked up on the PATH of
 * `env`). It returns only when the command could not start, with the reason.
 */
export function becomeCommand(
  command: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): string {
  const [program, ...args] = command

  if (program === undefined) {
    return 'no command was given'
  }

  // Absent where the system has no execve(2), such as Windows.
  if (process.execve === undefined) {
    return `${program} could not start: this platform cannot replace a process`
  }

  const path = Bun.which(program, { PATH: env['PATH'] ?? '' })

  if (path === null) {
    return `${program} is not on PATH`
  }

  const defined = Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )

  try {
    return process.execve(path, [program, ...args], defined)
  } catch (error) {
    return `${program} could not start: ${error instanceof Error ? error.message : String(error)}`
  }
}
