import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/**
 * Runs a command of the host, `argv[0]` the program and the rest its arguments, and answers the
 * exit code it ended with. It rejects when the command cannot run at all, and what it rejects with
 * never carries the arguments: they may hold a password.
 */
export type CommandRunner = (argv: readonly string[]) => Promise<number>

// Both paths are found from this file's own place in the repository, never from the directory
// the seed was started in: the seed runs from the repository root (`bun run seed`) and from its
// own package (`bun run test:db`).
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

/** The operator command's entry (`apps/gateway/scripts/operator/cli.ts`), as an absolute path. */
export const OPERATOR_CLI = fileURLToPath(
  new URL('../../../apps/gateway/scripts/operator/cli.ts', import.meta.url),
)

/**
 * The host's own runner: starts the command from the repository's root, as the operator command
 * and the seed are written to run, with the seed's output streams, and answers its exit code. It
 * runs under Bun (the seed's command) and under Node (the database suite), so it is no `Bun.spawn`.
 */
export const spawnCommand: CommandRunner = (argv) =>
  new Promise((resolve, reject) => {
    const [program, ...args] = argv

    if (program === undefined) {
      reject(new Error('there is no command to run'))

      return
    }

    const child = spawn(program, args, { cwd: REPOSITORY_ROOT, stdio: 'inherit' })

    // The program's name and the reason only: Node's own error carries the arguments too.
    child.once('error', (error: NodeJS.ErrnoException) => {
      reject(new Error(`${program} could not be started: ${error.code ?? error.name}`))
    })
    child.once('close', (code, signal) => {
      if (code === null) {
        reject(new Error(`${program} ended by ${signal ?? 'a signal'}`))

        return
      }

      resolve(code)
    })
  })
