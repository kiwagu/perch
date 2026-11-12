/**
 * The platform's operators of an e2e run, appointed as the host appoints them: the operator command
 * (`apps/gateway/scripts/operator/cli.ts`) sets an account's role in the directory of the run's own
 * stand, `SURREAL_URL`, signed in as the stand's root user, as its database suites sign in. It runs
 * as a child process under Bun from the repository's root, as the seed runs it: Playwright's
 * workers run in Node, which cannot load the `.surql` files the gateway's code imports. The
 * browser's network namespace forwards the stand's port (`scripts/isolated-network.ts`). A device
 * learns a role at its next hello, so a test reloads the operator's page after the grant.
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { z } from '@workspace/zod'

/** The repository's root, where the operator command runs from. */
const ROOT = fileURLToPath(new URL('../../../..', import.meta.url))

/** The operator command's entry. */
const OPERATOR_CLI = fileURLToPath(
  new URL('../../../../apps/gateway/scripts/operator/cli.ts', import.meta.url),
)

/** The e2e stand's root user, as the stand starts with it (`.mcproc/mcproc.yaml`). */
const STAND_USER = 'root'

/** The password of the e2e stand's root user, which no failure of a test prints. */
export const STAND_PASSWORD = 'root'

/** How long the command may take: it opens the directory, writes one field and closes it. */
const COMMAND_TIMEOUT_MS = 30_000

/** What the command does to the account's platform role. */
export type RoleChange = 'grant' | 'revoke'

/** How the command ended: its exit code, or the signal that ended it, and what it printed. */
export interface CommandEnd {
  readonly code: number | null
  readonly signal: string | null
  readonly output: string
}

/**
 * The run's stand: `bun run test:e2e` runs Playwright through `mcproc exec`, which sets
 * SURREAL_URL to this checkout's surrealdb-e2e from the manifest's vars. Read when a test first
 * appoints an operator, so the tests that appoint none run without it.
 */
export const standAddress = (env: Readonly<Record<string, string | undefined>>): string =>
  z
    .url({
      protocol: /^https?$/,
      error:
        'SURREAL_URL must be the http:// address of the surrealdb-e2e stand; run the suite with bun run test:e2e',
    })
    .parse(env['SURREAL_URL'])

/** What `bun` runs: the command, the stand and its user, then the action and the email. */
export const operatorArguments = (action: RoleChange, email: string, stand: string): string[] => [
  OPERATOR_CLI,
  `--url=${stand}`,
  `--user=${STAND_USER}`,
  `--pass=${STAND_PASSWORD}`,
  action,
  email,
]

/**
 * Why a command that did not exit 0 fails the test: its exit code, or the signal that ended it,
 * and its own words, which name the email and what went wrong; never its arguments, which hold the
 * password. The command never prints the password, which is taken out of its words all the same,
 * the user's name with it, as the two are the same word on the stand.
 */
export function operatorFailure(action: RoleChange, end: CommandEnd): Error {
  const ended =
    end.code === null ? `was ended by ${end.signal ?? 'a signal'}` : `exited ${end.code}`
  const said = end.output.trim().split(STAND_PASSWORD).join('<hidden>')

  return new Error(`the operator command did not ${action} the role: it ${ended}: ${said}`)
}

/**
 * Why the command could not start: the error's code, nothing more. Node's own errors carry the
 * arguments, in their message and in `spawnargs`, and one argument is the password.
 */
export function operatorNotStarted(error: unknown): Error {
  const reason =
    error instanceof Error
      ? 'code' in error && typeof error.code === 'string'
        ? error.code
        : error.name
      : 'an unknown error'

  return new Error(`the operator command could not be started: ${reason}`)
}

/** Runs `bun` with `args` from the repository's root and answers how it ended, with what it printed. */
function runBun(args: readonly string[]): Promise<CommandEnd> {
  return new Promise((resolve, reject) => {
    let output = ''
    const collect = (chunk: Buffer): void => {
      output += chunk.toString()
    }

    try {
      const child = spawn('bun', args, {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: COMMAND_TIMEOUT_MS,
      })

      child.stdout.on('data', collect)
      child.stderr.on('data', collect)
      child.once('error', (error) => reject(operatorNotStarted(error)))
      child.once('close', (code, signal) => resolve({ code, signal, output }))
    } catch (error) {
      // `spawn` throws, too, before any child exists: an argument holding a NUL, for one.
      reject(operatorNotStarted(error))
    }
  })
}

async function changeRole(action: RoleChange, email: string): Promise<void> {
  const end = await runBun(operatorArguments(action, email, standAddress(process.env)))

  if (end.code !== 0) {
    throw operatorFailure(action, end)
  }
}

/**
 * Makes the account of `email` an operator of the platform, as the host's command appoints one;
 * fails the test when the command does not exit 0. The account's devices learn the role at their
 * next hello.
 */
export const grantOperator = (email: string): Promise<void> => changeRole('grant', email)

/**
 * Takes the operator role from the account of `email`, as the host's command does; fails the test
 * when the command does not exit 0. The account's next console request is refused.
 */
export const revokeOperator = (email: string): Promise<void> => changeRole('revoke', email)
