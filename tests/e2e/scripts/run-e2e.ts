#!/usr/bin/env bun
/**
 * The e2e launcher: builds what the tests depend on through turbo, the web app's
 * production build into apps/web/dist included (a run never meets a stale build), with the
 * page helper `window.__perch.ui` in it (PERCH_UI_HOOKS=1) and the UI manifest beside it,
 * starts the mcproc `e2e` profile (the SurrealDB stand, the `gateway-e2e` gateway and
 * the `caddy-e2e` front, which serves that build to the tests) with `--reload`, so the
 * apps already online restart too (a run never meets a stale stand either: the database
 * starts empty, the gateway and the front load the current code and configuration),
 * waits for each in that order, runs Playwright with the given arguments and exits with
 * its code. The stand stays up between runs (`mcproc stop e2e` stops it), so `mcproc logs e2e`
 * shows what the tests saw. `bun run test:e2e` runs this script through `mcproc exec` with a 4G
 * memory lease (the build and the browsers wait their turn when the host is full) and with
 * E2E_BASE_URL, which Playwright reads, set to this checkout's front.
 *
 *   bun run test:e2e [<playwright args>]       CI=1 runs the specs one at a time
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const e2eDir = fileURLToPath(new URL('..', import.meta.url))
// The page caddy-e2e serves; the build below must leave it in place.
const webIndex = fileURLToPath(new URL('../../../apps/web/dist/index.html', import.meta.url))
const args = process.argv.slice(2)

function run(
  command: string,
  commandArgs: readonly string[],
  cwd = root,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const result = spawnSync(command, [...commandArgs], { cwd, stdio: 'inherit', env })

  if (result.error) {
    console.error(`run-e2e: ${command} could not start: ${result.error.message}`)

    return 1
  }

  return result.status ?? 1
}

function main(): number {
  const mcproc = (...rest: string[]) => run('mcproc', ['--project', root, ...rest])

  // The tests' dependencies and, named on its own, the web app the front serves, built with
  // the page helper `window.__perch.ui` that the tests call (PERCH_UI_HOOKS=1).
  const built =
    run(
      'bunx',
      ['turbo', 'run', 'build', '--filter=@workspace/e2e^...', '--filter=@workspace/web...'],
      root,
      { ...process.env, PERCH_UI_HOOKS: '1' },
    ) === 0

  if (!built) {
    console.error('run-e2e: the build failed')

    return 1
  }

  if (!existsSync(webIndex)) {
    console.error(`run-e2e: the build left no ${webIndex}, so caddy-e2e has no page to serve`)

    return 1
  }

  // The stand's apps declare their memory, so the start may be queued behind other stands:
  // `start` answers at once and prints the place in the queue, `wait` rides through the queue
  // until the app is up (mcproc's longest wait, 600 s, bounds the first one; the others follow
  // within seconds), and when the run gives up, `stop` cancels whatever is still queued, so the
  // stand does not come up later with nobody to test it.
  const waitFor = (app: string, until: string, timeout: number) =>
    mcproc('wait', app, '--until', until, '--timeout', String(timeout)) === 0
  const ready =
    mcproc('start', 'e2e', '--reload') === 0 &&
    waitFor('surrealdb-e2e', 'url-ok', 600) &&
    waitFor('gateway-e2e', 'url-ok', 120) &&
    waitFor('caddy-e2e', 'url-ok', 120)

  if (!ready) {
    console.error('run-e2e: the e2e stand did not come up; stopping what was started or queued')
    mcproc('stop', 'e2e')

    return 1
  }

  return run('bunx', ['playwright', 'test', ...args], e2eDir)
}

process.exit(main())
