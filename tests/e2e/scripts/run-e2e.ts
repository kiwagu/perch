#!/usr/bin/env bun
/**
 * The e2e launcher: builds what the tests depend on through turbo, the web app's
 * production build into apps/web/dist included (a run never meets a stale build),
 * starts the mcproc `e2e` profile (the SurrealDB stand, the `gateway-e2e` gateway and
 * the `caddy-e2e` front, which serves that build to the tests) with `--reload`, so the
 * apps already online restart too (a run never meets a stale stand either: the database
 * starts empty, the gateway and the front load the current code and configuration),
 * waits for each in that order, runs Playwright with the given arguments and exits with
 * its code. `--down` stops the profile instead. The stand stays up between runs, so
 * `mcproc logs e2e` shows what the tests saw. `bun run test:e2e` runs this script through
 * `mcproc exec` with a 4G memory lease (the build and the browsers wait their turn when the
 * host is full) and with E2E_BASE_URL, which Playwright reads, set to this checkout's front.
 *
 *   bun run test:e2e [<playwright args>]       CI=1 runs the specs one at a time
 *   bun run test:e2e --down
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const e2eDir = fileURLToPath(new URL('..', import.meta.url))
// The page caddy-e2e serves; the build below must leave it in place.
const webIndex = fileURLToPath(new URL('../../../apps/web/dist/index.html', import.meta.url))
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

  // The tests' dependencies and, named on its own, the web app the front serves.
  const built =
    run('bunx', [
      'turbo',
      'run',
      'build',
      '--filter=@workspace/e2e^...',
      '--filter=@workspace/web...',
    ]) === 0

  if (!built) {
    console.error('run-e2e: the build failed')

    return 1
  }

  if (!existsSync(webIndex)) {
    console.error(`run-e2e: the build left no ${webIndex}, so caddy-e2e has no page to serve`)

    return 1
  }

  const waitFor = (app: string, until: string) =>
    mcproc('wait', app, '--until', until, '--timeout', '120') === 0
  const ready =
    mcproc('start', 'e2e', '--reload') === 0 &&
    waitFor('surrealdb-e2e', 'url-ok') &&
    waitFor('gateway-e2e', 'url-ok') &&
    waitFor('caddy-e2e', 'url-ok')

  if (!ready) {
    console.error('run-e2e: the e2e stand did not come up')

    return 1
  }

  return run('bunx', ['playwright', 'test', ...args], e2eDir)
}

process.exit(main())
