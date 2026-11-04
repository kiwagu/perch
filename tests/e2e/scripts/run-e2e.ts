#!/usr/bin/env bun
/**
 * The e2e launcher: builds the app and brings the e2e stand up (`prepareStand`, `stand.ts`),
 * runs Playwright with the given arguments in a network namespace of its own
 * (`isolated-network.ts`), so no container started or stopped on the host aborts the browser's
 * requests, and exits with its code. The stand stays up between runs, so `mcproc logs e2e` shows
 * what the tests saw. `bun run test:e2e` runs this script through `mcproc exec` with a 4G memory
 * lease (the build and the browsers wait their turn when the host is full) and with E2E_BASE_URL,
 * which Playwright reads, set to this checkout's front, and MAILBOX_URL to its mailbox.
 *
 *   bun run test:e2e [<playwright args>]   no arguments: the full run, which earns a receipt
 */

import { fileURLToPath } from 'node:url'

import { isolatedCommand, pastaInstalled } from './isolated-network'
import { prepareStand, run } from './stand'

const e2eDir = fileURLToPath(new URL('..', import.meta.url))
const [command = 'pasta', ...args] = isolatedCommand(
  ['bunx', 'playwright', 'test', ...process.argv.slice(2)],
  process.env,
)

// pasta is checked first: the build and the stand's restart are not worth it without it.
process.exit(
  pastaInstalled('run-e2e') && prepareStand('run-e2e') ? run('run-e2e', command, args, e2eDir) : 1,
)
