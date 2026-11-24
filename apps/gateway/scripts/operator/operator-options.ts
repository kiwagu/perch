import { err, ok, type Result } from 'neverthrow'

import { wsRpcUrl } from '@workspace/data/engines/remote'
import { z } from '@workspace/zod'

import { DIRECTORY, NAMESPACE } from '../../src/config'

/** What the command prints beside a refusal of its arguments. */
export const OPERATOR_USAGE =
  'usage: operator [--url=<address>] [--namespace=<ns>] [--database=<db>] [--user=<user>] [--pass=<password>] grant|revoke <email>'

/** What the command is asked: the account's role to set, and the directory it is set in. */
export interface OperatorRequest {
  readonly action: 'grant' | 'revoke'
  readonly email: string
  /** The directory's WebSocket RPC endpoint, `ws://` or `wss://`, ending in `/rpc`. */
  readonly url: string
  readonly namespace: string
  readonly database: string
  /** A system user of the stand: a root user, as the seed's sweep signs in. */
  readonly credentials: { readonly username: string; readonly password: string }
}

const OPTIONS = ['url', 'namespace', 'database', 'user', 'pass']

/**
 * The stand's `http(s)://` or `ws(s)://` address, as the seed names its stand. It carries no user
 * or password: the command signs in with `--user` and `--pass`, and an address with credentials in
 * it would print them in the first failure that names it.
 */
const standAddress = z
  .url({
    protocol: /^(https?|wss?)$/,
    error: '--url or SURREAL_DEV_URL must be the http(s):// or ws(s):// address of the stand',
  })
  .refine(
    (address) => {
      const parsed = URL.parse(address)

      return parsed !== null && parsed.username === '' && parsed.password === ''
    },
    { error: '--url or SURREAL_DEV_URL must not carry credentials: use --user and --pass' },
  )

const optionValue = (name: string) => z.string().min(1, { error: `--${name} must not be empty` })

/** What the arguments and the environment name, as the request they make. */
const operatorRequest = z
  .object({
    action: z.enum(['grant', 'revoke'], { error: 'the first argument must be grant or revoke' }),
    email: z.email({ error: 'the second argument must be the email of the account' }),
    url: standAddress.transform(wsRpcUrl),
    namespace: optionValue('namespace'),
    database: optionValue('database'),
    user: optionValue('user'),
    pass: optionValue('pass'),
  })
  .transform(
    ({ user, pass, ...rest }): OperatorRequest => ({
      ...rest,
      credentials: { username: user, password: pass },
    }),
  )

/** The `--name=value` options among `argv` and the arguments that are not options. */
function split(
  argv: readonly string[],
): Result<{ options: ReadonlyMap<string, string>; positionals: readonly string[] }, string> {
  const options = new Map<string, string>()
  const positionals: string[] = []

  for (const arg of argv) {
    if (!arg.startsWith('--')) {
      positionals.push(arg)
      continue
    }

    const equals = arg.indexOf('=')
    // Only the name is ever said back: what follows `=` may be a password.
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals)

    if (!OPTIONS.includes(name)) {
      return err(`unknown option --${name}`)
    }

    if (equals === -1) {
      return err(`--${name} is written --${name}=<value>`)
    }

    if (options.has(name)) {
      return err(`--${name} is given twice`)
    }

    options.set(name, arg.slice(equals + 1))
  }

  return ok({ options, positionals })
}

/**
 * What the command is asked, from its arguments and the environment: `grant|revoke <email>` and
 * the options of the seed's sweep. The stand is `--url`, else `SURREAL_DEV_URL`, opened at its
 * WebSocket RPC endpoint whatever scheme it is given in; the namespace and database are the
 * gateway's own, and the user the stand's root, unless an option says otherwise. A refusal is one
 * line that names the argument and never its value.
 */
export function readOperatorRequest(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Result<OperatorRequest, string> {
  return split(argv).andThen(({ options, positionals }) => {
    const [actionArgument, emailArgument, ...surplus] = positionals

    if (surplus.length > 0) {
      return err('only one email can be given')
    }

    const request = operatorRequest.safeParse({
      action: actionArgument,
      email: emailArgument,
      url: options.get('url') ?? env['SURREAL_DEV_URL'],
      namespace: options.get('namespace') ?? NAMESPACE,
      database: options.get('database') ?? DIRECTORY,
      user: options.get('user') ?? 'root',
      pass: options.get('pass') ?? 'root',
    })

    return request.success
      ? ok(request.data)
      : err(request.error.issues[0]?.message ?? 'the arguments are not readable')
  })
}
