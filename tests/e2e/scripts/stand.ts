/**
 * What a run against the e2e stand starts with, the e2e launcher's and the timing
 * measurement's: the build of what the tests depend on, through turbo, the web app's
 * production build into apps/web/dist included (a run never meets a stale build), with the page
 * helper `window.__perch.ui` in it (PERCH_UI_HOOKS=1) and the UI manifest beside it, then the
 * mcproc `e2e` profile (the SurrealDB stand, the `gateway-e2e` gateway and the `caddy-e2e` front,
 * which serves that build) started with `--reload`, so the apps already online restart too (a
 * run never meets a stale stand either: the database starts empty, the gateway and the front
 * load the current code and configuration), each waited for in that order. The stand stays up
 * after the run (`mcproc stop e2e` stops it).
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const root = fileURLToPath(new URL('../../..', import.meta.url))
// The page caddy-e2e serves; the build below must leave it in place.
const webIndex = fileURLToPath(new URL('../../../apps/web/dist/index.html', import.meta.url))

/** Runs a command with the terminal's output, and gives its exit code (1 when it cannot start). */
export function run(
  who: string,
  command: string,
  commandArgs: readonly string[],
  cwd = root,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const result = spawnSync(command, [...commandArgs], { cwd, stdio: 'inherit', env })

  if (result.error) {
    console.error(`${who}: ${command} could not start: ${result.error.message}`)

    return 1
  }

  return result.status ?? 1
}

/** Builds the app and brings the e2e stand up; false, having said why, when either fails. */
export function prepareStand(who: string): boolean {
  const mcproc = (...rest: string[]) => run(who, 'mcproc', ['--project', root, ...rest])

  // The tests' dependencies and, named on its own, the web app the front serves, built with
  // the page helper `window.__perch.ui` that the tests call (PERCH_UI_HOOKS=1).
  const built =
    run(
      who,
      'bunx',
      ['turbo', 'run', 'build', '--filter=@workspace/e2e^...', '--filter=@workspace/web...'],
      root,
      { ...process.env, PERCH_UI_HOOKS: '1' },
    ) === 0

  if (!built) {
    console.error(`${who}: the build failed`)

    return false
  }

  if (!existsSync(webIndex)) {
    console.error(`${who}: the build left no ${webIndex}, so caddy-e2e has no page to serve`)

    return false
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
    console.error(`${who}: the e2e stand did not come up; stopping what was started or queued`)
    mcproc('stop', 'e2e')

    return false
  }

  return true
}
