#!/usr/bin/env bun
/**
 * Starts a local stand's gateway, as the mcproc manifest's gateway apps run it: the stand's values
 * come in as flags (from the manifest's vars, resolved for this checkout's slot), the stand
 * operator defines the gateway's user on the stand's SurrealDB, and this process then becomes the
 * command after `--`, run with the gateway's settings for that stand (`settings.ts`). Run it from
 * the repository root.
 *
 *   bun scripts/stand-gateway/cli.ts --surreal=8000 --gateway=5181 --front=5443 --smtp=1025 \
 *     --mail-from='Perch <no-reply@example.test>' --auth-secret=<secret> -- bun apps/gateway/src/index.ts
 */

import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'

import { STAND_FLAGS } from './names.ts'
import { gatewaySettings, standFrom } from './settings.ts'
import { becomeCommand, defineGatewayUser } from './start.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const argv = process.argv.slice(2)
const end = argv.indexOf('--')
const command = end === -1 ? [] : argv.slice(end + 1)

function fail(message: string): never {
  console.error(`stand-gateway: ${message}`)
  process.exit(1)
}

if (command.length === 0) {
  fail('give the command that runs the gateway after --')
}

const flags = (() => {
  try {
    return parseArgs({
      args: argv.slice(0, end),
      options: Object.fromEntries(
        Object.values(STAND_FLAGS).map((flag) => [flag, { type: 'string' as const }]),
      ),
      strict: true,
      allowPositionals: false,
    }).values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
})()
const read = standFrom(STAND_FLAGS, (flag) => flags[flag])

if ('problems' in read) {
  fail(read.problems.map((problem) => `--${problem}`).join('; '))
}

if (defineGatewayUser(read.stand, root) !== 0) {
  process.exit(1)
}

fail(becomeCommand(command, { ...process.env, ...gatewaySettings(read.stand) }))
