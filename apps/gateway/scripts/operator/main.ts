/**
 * The operator command behind `cli.ts`.
 *
 *   operator [--url=<address>] [--namespace=<ns>] [--database=<db>] [--user=<user>]
 *            [--pass=<password>] grant|revoke <email>
 *
 * `grant` writes the platform role `operator` on the account of the email in the directory of a
 * stand, `revoke` the role `user`, the plugin's default: nothing else of the account changes, and
 * its devices learn the role at their next hello. The stand is `--url`, else `SURREAL_DEV_URL`,
 * which `bun run operator` sets from the mcproc manifest: this checkout's dev stand. It is
 * reached as the seed's sweep reaches it: `--namespace` and `--database` name the gateway's
 * directory by default, and `--user` and `--pass` a system user of the stand, by default its root.
 * Exits 0 once the role is set, 1 when no account has the email or the stand failed, 2 for
 * arguments it refuses.
 */

import type { ResultAsync } from 'neverthrow'
import { match } from 'ts-pattern'

import type { DataError, LocalDb } from '@workspace/data'

import { openDirectory } from './open-directory'
import { OPERATOR_USAGE, type OperatorRequest, readOperatorRequest } from './operator-options'
import { setPlatformRole } from './platform-role'

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  open: (request: OperatorRequest) => ResultAsync<LocalDb, DataError> = openDirectory,
): Promise<number> {
  const request = readOperatorRequest(argv, env)

  if (request.isErr()) {
    console.error(`operator: ${request.error}`)
    console.error(OPERATOR_USAGE)

    return 2
  }

  const { action, email } = request.value
  const opened = await open(request.value)

  if (opened.isErr()) {
    console.error(`operator: ${opened.error.code} ${opened.error.message}`)

    return 1
  }

  const directory = opened.value
  const written = await setPlatformRole(directory, email, action === 'grant' ? 'operator' : 'user')

  await directory.close()

  if (written.isErr()) {
    console.error(`operator: ${written.error.code} ${written.error.message}`)

    return 1
  }

  return match(written.value)
    .with('set', () => {
      console.log(`operator: ${action === 'grant' ? 'granted to' : 'revoked from'} ${email}`)

      return 0
    })
    .with('no-account', () => {
      console.error(`operator: no account has the email ${email}`)

      return 1
    })
    .exhaustive()
}
