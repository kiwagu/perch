# Operator command (module `operator`)

## Role in the architecture

The host command that appoints the platform's operators, the accounts that run its console. It
writes one field, `identity.role` in the directory of a stand (or of production, run by hand by
the owner): `grant` gives the account of an email the role `operator`, `revoke` the role `user`,
the default Better Auth's admin plugin writes at an account's creation. It changes the store and
nothing else of the account: a host command cannot reach the running gateway's memory, so no
session ends and no socket closes. The gateway reads the role with the session on every request,
so an account's next request has it, and its open devices learn it at their next hello, that is
at their next reconnect or reload.

The directory is opened as the seed's sweep opens its stand, written in the gateway because it may
not import the web: an `http(s)://` address is opened at its `ws(s)://…/rpc` endpoint and the user
signs in at the root of the stand. Opening applies the directory schema as the gateway does, which
leaves a database that already has it alone; run the command from the version the stand runs.

## Surface

`operator [--url=<address>] [--namespace=<ns>] [--database=<db>] [--user=<user>] [--pass=<password>] grant|revoke <email>`

| Option | Default |
|---|---|
| `--url` | `SURREAL_DEV_URL`: the stand's `http(s)://` or `ws(s)://` address, with no credentials in it |
| `--namespace` | the gateway's namespace, `app` |
| `--database` | the gateway's directory, `directory` |
| `--user`, `--pass` | the stand's root user, `root` and `root` |

The email is matched in any case. The command reads `SURREAL_DEV_URL` and no other variable,
opens no file of its own and never prints the password.

Exit codes: `0` once the role is written; `1` when no account has the email, or the stand could
not be opened or written (the message says which); `2` for arguments it refuses (a missing or
unknown action, no email, an address that is not the stand's, an option it does not know), with
the usage line. An account that already has the role is written again and answers `0`.

Files: `cli.ts` (the entry, which registers the `.surql` loader first), `main.ts` (the exit
codes), `operator-options.ts` (the arguments read), `open-directory.ts` (the connection),
`platform-role.ts` with `surql/identity-role-set.surql` (the write).

## Commands

- On this checkout's dev stand, from the repository root: `bun run operator -- grant <email>`,
  and `bun run operator -- revoke <email>` to take the role back. The root script goes through
  `mcproc exec`, which gives the command the dev stand's address (`SURREAL_DEV_URL`); the stand's
  root user is the default one. For any other stand, name it and its user:
  `bun run operator -- --url=<address> --user=<user> --pass=<password> grant <email>`.
- In production the owner runs, from the repository at the version the stand runs:
  `bun apps/gateway/scripts/operator/cli.ts --url=<the directory's address> --user=<a root system
  user> --pass=<its password> grant <email>`. The password is an option, the only way to give it,
  so keep it out of the shell's history by reading it into a variable first: `read -rs
  OPERATOR_PASS`, then `--pass="$OPERATOR_PASS"`. The process list still shows the arguments
  while the command runs.
- Tests, from `apps/gateway`: `bun --bun vitest run scripts/operator` (in-memory directory; the
  command itself is run by hand against a stand).
