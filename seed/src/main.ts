/**
 * The seed command behind `cli.ts`.
 *
 *   seed [--fresh] [--reset] [--manifest=<file>] [--url=<stand>] [--database=<name>]
 *   seed sweep [--url=<stand>] [--database=<name>]
 *
 * Also `--namespace=`, `--user=` and `--pass=` for the stand's system user. The
 * stand defaults to the local dev stand with its local credentials.
 */

import { writeFileSync } from 'node:fs'

import type { SeedMode } from './catalog'
import { runSeed, type StandTarget, sweep } from './seed'

const FLAGS = new Set(['--fresh', '--reset'])

const OPTIONS = ['url', 'namespace', 'database', 'user', 'pass', 'manifest']

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

export async function main(argv: readonly string[]): Promise<number> {
  const unknown = unknownArguments(argv)

  if (unknown.length > 0) {
    console.error(`seed: unknown argument(s): ${unknown.join(' ')}`)

    return 1
  }

  const target: StandTarget = {
    url: readOption(argv, 'url') ?? 'http://127.0.0.1:8000',
    namespace: readOption(argv, 'namespace') ?? 'app',
    database: readOption(argv, 'database') ?? 'app',
    credentials: {
      username: readOption(argv, 'user') ?? 'root',
      password: readOption(argv, 'pass') ?? 'root',
    },
  }

  if (argv[0] === 'sweep') {
    return (await sweep(target)).match(
      ({ accounts }) => {
        console.log(`seed: swept ${accounts} account(s) from ${target.url}`)

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

  return 0
}
