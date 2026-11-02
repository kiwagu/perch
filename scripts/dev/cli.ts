#!/usr/bin/env bun
/**
 * `bun run dev` at the repository root: the Bun dev scripts of the workspaces in the foreground,
 * through turbo (the gateway's `bun --watch` and the web app's build watcher into
 * apps/web/dist-dev), with this checkout's dev stand. It reads the stand from
 * `mcproc --json describe` (the manifest's vars resolved for this checkout's slot), checks it
 * (`preflight.ts`), defines the gateway's user on the dev SurrealDB with the stand operator and
 * becomes turbo, run with the gateway's settings (`scripts/stand-gateway/`, the mapping the
 * manifest's gateway apps start with too). SurrealDB, MailDev and Caddy are dedicated services it
 * does not start: `mcproc start services`.
 *
 *   bun run dev [--exclude a,b] [-x c] [-- turbo args]
 */

import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { becomeCommand, defineGatewayUser, gatewaySettings } from '../stand-gateway/index.ts'

import { devStand, mcprocJson, pm2Scripts } from './mcproc.ts'
import { preflight } from './preflight.ts'
import { answers, portFree } from './probes.ts'
import { turboRun } from './turbo-run.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))

function fail(messages: readonly string[]): never {
  for (const message of messages) {
    console.error(`bun run dev: ${message}`)
  }

  process.exit(1)
}

const { excludes, args } = turboRun('dev', process.argv.slice(2))
const runs = {
  gateway: !excludes.includes('@workspace/gateway'),
  web: !excludes.includes('@workspace/web'),
}

const described = mcprocJson(root, ['describe'])
const read = typeof described === 'string' ? { problems: [described] } : devStand(described.json)

if ('problems' in read) {
  fail(read.problems)
}

const listed = mcprocJson(root, ['ls'])
const pm2 = typeof listed === 'string' ? { problems: [listed] } : pm2Scripts(listed.json)

if ('problems' in pm2) {
  fail(pm2.problems)
}

const { stand, urls, slot } = read.devStand
const [surreal, mailbox, front, free] = await Promise.all([
  answers(urls.surreal),
  answers(urls.mailbox),
  answers(urls.front),
  portFree(stand.gateway),
])
const { errors, warnings } = preflight({
  runs,
  surreal: { url: urls.surreal, answers: surreal },
  mailbox: { url: urls.mailbox, answers: mailbox },
  front: { url: urls.front, answers: front },
  gatewayPort: { port: stand.gateway, free },
  pm2: pm2.running,
})

for (const warning of warnings) {
  console.error(`bun run dev: warning: ${warning}`)
}

if (errors.length > 0) {
  fail(errors)
}

if (runs.gateway && defineGatewayUser(stand, root) !== 0) {
  fail(['the stand operator could not define the gateway user on the dev SurrealDB'])
}

const running = [
  runs.gateway && `the gateway on 127.0.0.1:${stand.gateway}`,
  runs.web && 'the watcher into apps/web/dist-dev',
].filter((part): part is string => typeof part === 'string')

console.error(
  `bun run dev: the dev stand of slot ${slot}: ${[...running, `the app at ${urls.front}`].join(', ')}`,
)

const path = `${join(root, 'node_modules', '.bin')}${delimiter}${process.env['PATH'] ?? ''}`

fail([becomeCommand(['turbo', ...args], { ...process.env, PATH: path, ...gatewaySettings(stand) })])
