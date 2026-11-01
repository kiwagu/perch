#!/usr/bin/env bun
/**
 * The e2e launcher: builds the app and brings the e2e stand up (`prepareStand`, `stand.ts`),
 * runs Playwright with the given arguments and exits with its code. The stand stays up between
 * runs, so `mcproc logs e2e` shows what the tests saw. `bun run test:e2e` runs this script
 * through `mcproc exec` with a 4G memory lease (the build and the browsers wait their turn when
 * the host is full) and with E2E_BASE_URL, which Playwright reads, set to this checkout's front.
 *
 *   bun run test:e2e [<playwright args>]       CI=1 runs the specs one at a time
 */

import { fileURLToPath } from 'node:url'

import { prepareStand, run } from './stand'

const e2eDir = fileURLToPath(new URL('..', import.meta.url))

process.exit(
  prepareStand('run-e2e')
    ? run('run-e2e', 'bunx', ['playwright', 'test', ...process.argv.slice(2)], e2eDir)
    : 1,
)
