/**
 * The seed command behind `cli.ts`.
 *
 *   seed [--fresh] [--reset] [--manifest=<file>] [--gateway=<url>] [--url=<stand>]
 *   seed sweep [--url=<stand>]
 *
 * Accounts are created through the gateway at `--gateway`, else at `GATEWAY_DEV_URL`, which
 * `bun run seed` sets from the mcproc manifest: this checkout's dev gateway. The stand behind
 * it is reached only by the sweep (`seed sweep`, and `--reset` before seeding): `--url` (else
 * `SURREAL_DEV_URL`, set the same way), `--namespace=`, `--database=`, `--user=` and `--pass=`
 * name it and its system user, by default the stand's root on the gateway's database.
 */

import { writeFileSync } from 'node:fs'

import { z } from '@workspace/zod'

import type { SeedMode } from './catalog'
import { runSeed, type StandTarget, sweep } from './seed'

const FLAGS = new Set(['--fresh', '--reset'])

const OPTIONS = ['gateway', 'url', 'namespace', 'database', 'user', 'pass', 'manifest']

/** The gateway's `http(s)://` address, without a trailing slash: its routes are appended. */
const gatewayAddress = z
  .url({ protocol: /^https?$/, error: 'must be the http(s):// address of the gateway' })
  .transform((url) => url.replace(/\/+$/, ''))

/** The stand's `http(s)://` or `ws(s)://` address, reached by the sweep as its system user. */
const standAddress = z.url({
  protocol: /^(https?|wss?)$/,
  error: 'must be the http(s):// or ws(s):// address of the stand',
})

function readOption(argv: readonly string[], name: string): string | undefined {
  const prefix = `--${name}=`

  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length)
}

function unknownArguments(argv: readonly string[]): string[] {
  return argv.filter(
    (arg, index) =>
      !(index === 0 && arg === 'sweep') &&
      !FLAGS.has(arg) &&
      !OPTIONS.some((name) => arg.startsWith(`--${name}=`)),
  )
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Promise<number> {
  const unknown = unknownArguments(argv)

  if (unknown.length > 0) {
    console.error(`seed: unknown argument(s): ${unknown.join(' ')}`)

    return 1
  }

  const gateway = gatewayAddress.safeParse(readOption(argv, 'gateway') ?? env['GATEWAY_DEV_URL'])

  if (!gateway.success) {
    console.error(`seed: --gateway or GATEWAY_DEV_URL ${gateway.error.issues[0]?.message ?? ''}`)

    return 1
  }

  const stand = standAddress.safeParse(readOption(argv, 'url') ?? env['SURREAL_DEV_URL'])

  if (!stand.success) {
    console.error(`seed: --url or SURREAL_DEV_URL ${stand.error.issues[0]?.message ?? ''}`)

    return 1
  }

  const target: StandTarget = {
    gatewayUrl: gateway.data,
    url: stand.data,
    namespace: readOption(argv, 'namespace') ?? 'app',
    database: readOption(argv, 'database') ?? 'directory',
    credentials: {
      username: readOption(argv, 'user') ?? 'root',
      password: readOption(argv, 'pass') ?? 'root',
    },
  }

  if (argv[0] === 'sweep') {
    return (await sweep(target)).match(
      ({ accounts, organisations }) => {
        console.log(
          `seed: swept ${accounts} account(s) and ${organisations} organisation(s) from ${target.url}`,
        )

        return 0
      },
      (error) => {
        console.error(`seed: ${error.code} ${error.message}`)

        return 1
      },
    )
  }

  const mode: SeedMode = argv.includes('--fresh')
    ? { kind: 'fresh', run: Date.now().toString(36) }
    : { kind: 'demo' }
  const result = await runSeed({ ...target, mode, reset: argv.includes('--reset') })

  if (result.isErr()) {
    console.error(`seed: ${result.error.code} ${result.error.message ?? ''}`)

    return 1
  }

  const manifest = readOption(argv, 'manifest')

  if (manifest) {
    writeFileSync(manifest, `${JSON.stringify(result.value, null, 2)}\n`)
  }

  for (const [ref, entry] of Object.entries(result.value.accounts)) {
    console.log(`seed: ${ref} ${entry.email} ${entry.id}`)
  }

  for (const [ref, entry] of Object.entries(result.value.organisations)) {
    console.log(`seed: ${ref} ${entry.key} ${entry.id}`)
  }

  return 0
}
