#!/usr/bin/env bun
/**
 * The e2e launcher: builds what the tests depend on through turbo (a run never
 * meets a stale build), starts the mcproc `e2e` profile (the SurrealDB stand and
 * the `web-e2e` dev server), waits until both answer, runs Playwright with the
 * given arguments and exits with its code. `--down` stops the profile instead. The
 * stand stays up between runs, so `mcproc logs e2e` shows what the tests saw.
 *
 *   bun run test:e2e [<playwright args>]       CI=1 runs the specs one at a time
 *   bun run test:e2e --down
 */

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const e2eDir = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)

function run(command: string, commandArgs: readonly string[], cwd = root): number {
  const result = spawnSync(command, [...commandArgs], { cwd, stdio: 'inherit' })

  if (result.error) {
    console.error(`run-e2e: ${command} could not start: ${result.error.message}`)

    return 1
  }

  return result.status ?? 1
}

function main(): number {
  const mcproc = (...rest: string[]) => run('mcproc', ['--project', root, ...rest])

  if (args.includes('--down')) {
    return mcproc('stop', 'e2e')
  }

  const ready =
    run('bunx', ['turbo', 'run', 'build', '--filter=@workspace/e2e^...']) === 0 &&
    mcproc('start', 'e2e') === 0 &&
    mcproc('wait', 'surrealdb-e2e', '--until', 'url-ok', '--timeout', '120') === 0 &&
    mcproc('wait', 'web-e2e', '--until', 'url-ok', '--timeout', '120') === 0

  if (!ready) {
    console.error('run-e2e: the build failed or the e2e stand did not come up')

    return 1
  }

  return run('bunx', ['playwright', 'test', ...args], e2eDir)
}

process.exit(main())
