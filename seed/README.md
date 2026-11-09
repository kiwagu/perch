# Seed (`@workspace/seed`)

## Role in the architecture

Seed data created through the product path rather than by SurrealQL inserts: a seed
client is a device of the application running in Bun or Node (its composition root over an
in-memory database), so an account is signed up through the gateway's HTTP routes, verified
through the link of the mail the gateway sends it, read from the stand's mailbox
(`@workspace/mailbox`), as a person opens it, and its profile is written by the user module's
services, the command bus and the Loro write path, then synced to the gateway over its WebSocket
like any device's changes. An existing account signs in; one not verified yet has its mail sent
again; an email that has an account with another password fails as invalid credentials, as a
sign-in does. The seed waits
until the gateway has acknowledged everything; as one device holding one account at a time, it
signs the account it is in out before it enters the next. Removing seed data is an operator task on a stand instead: the sweep connects to the
stand's SurrealDB as a system user on the gateway's database. All seed data uses addresses
on `example.test`, which is how the sweep finds it. The catalog is standalone, so e2e tests
generate their data from the same presets. Organisations are seeded after every account
exists: the administrator signs in, creates the organisation (the key `acme`; a `fresh` seed
suffixes the run id, `acme_<run>`) and invites the members by email; each invite answers the
invitation's id, and each member then signs in and accepts it by that id (a member of the
organisation already, as on a second run, answers none and accepts nothing). The gateway smoke test leaves an organisation `smoke_<time>`
behind, created by an `@example.test` identity, so the sweep removes it too.

## Key exports

- `catalog`, `accountFor(preset, mode)`, `organisationFor(preset, mode)`, `validateCatalog()`,
  `SEED_EMAIL_DOMAIN`: the presets (name, bio and language; organisations with their key,
  administrator and members, by account ref), the account data for a `demo` (same address every run) or `fresh`
  (new address per run) seed, its password `Seed-<ref>-password-1` in both, and the offline check
  of the catalog (`validateCatalog(candidate, mode?)`: each account's password must keep the rules
  of a new password, and the organisation keys must be tenant keys as given and as the run's mode
  suffixes them); `./catalog` exports them alone, without the gateway client, for the e2e tests.
- `runSeed(options)`: seeds every preset through the gateway at `gatewayUrl` and returns
  the manifest (`accounts`: ref to account id, email and profile id; `organisations`: ref to
  organisation id, key and name); `demo` is idempotent, and `reset` sweeps the stand first. The
  catalog is checked for the run's mode before anything (a `fresh` run id that makes a key too
  long is refused). An organisation whose key exists is found only when its administrator seeds
  it; a key taken by an organisation the account only belongs to is an error.
  `fetcher` replaces the global `fetch` for the gateway's HTTP routes (the CLI passes none);
  `inbox` is where the verification mails are read (the CLI passes a `Mailbox`).
- `sweep(target, { emails? })`: removes the seeded accounts (or only those at `emails`)
  with the organisations they created (their databases `t_<key>`, memberships, pending
  invitations and directory rows), the pending invitations to their addresses, their
  memberships in organisations of others with the member rows in those
  organisations' databases, their profiles and the server's copy of their regions (`_replica_head`,
  `_replica_snapshot`, `_replica_update`, `_replica_projected`, `_replica_peer`). Of a region
  the gateway keeps in memory only what a connected device subscribed to, unloaded 60 s after the last
  device left. Re-creating an organisation under the key of a swept one works: the gateway
  opens a new connection to its database. Sweep only once the seed clients have left (`runSeed` closes its client
  before it returns), or a device still connected keeps the swept region in the gateway.
- `openStand(target)`: the operator's connection to a stand that the sweep runs on, as a
  system user; the directory schema is applied as the gateway applies it, which leaves a stand
  that already has it alone. `openStandTenant(target, database)` connects to an
  organisation's database the same way, with the organisation schema, for the member rows.

## Commands

- `mcproc start dev && bun run seed` (from the repository root): seeds through this
  checkout's dev gateway. `bun run seed` runs the command through `mcproc exec`, which sets
  `GATEWAY_DEV_URL`, `MAILBOX_DEV_URL` and `SURREAL_DEV_URL` from the mcproc manifest
  (`http://127.0.0.1:5181`, `http://127.0.0.1:1080` and `http://127.0.0.1:8000` in the main
  checkout); `--gateway=<url>` names another gateway, `--mailbox=<url>` the REST API of its
  stand's mailbox, where each new account's verification mail is read (the command fails naming
  both when neither is given).
  Flags: `--fresh`, `--reset` (sweep first), `--manifest=<file>`. The stand behind the
  gateway is reached only by the sweep: `--url=` (else `SURREAL_DEV_URL`),
  `--namespace=` and `--database=` (default `app` and `directory`, the gateway's
  database), `--user=` and `--pass=` (default the stand's root). Demo
  accounts sign in with the password `Seed-<ref>-password-1` (`Seed-ann-password-1`), which keeps
  the rules of a new password. A stand seeded before those rules keeps its demo accounts with the
  password they were created with, `<ref>-seed-password`, which still signs in by hand; a `demo`
  run over such a stand fails at their sign-in as invalid credentials, so seed it with `--reset`
  (which sweeps the seed data first) to recreate them with the new password.
- `bun run seed:sweep`: removes the seed data from the stand (same stand flags).
- `bun run test`: the offline catalog check, that `runSeed` calls the gateway through the `fetcher` it is given, and that each organisation's members join by accepting the invitation their own invite answered, none on a second run.
- `bun run test:db`: seeding through the gateway, a second device reading what was
  seeded (the member's view of the organisation included), and the sweep, against the e2e stand (`mcproc start e2e` first): the gateway at
  `GATEWAY_URL`, its SurrealDB at `SURREAL_URL` and its mailbox at `MAILBOX_URL`, where the seed
  verifies each new account, with the origin of the stand's front in `GATEWAY_PUBLIC_URL`, all set
  by `bun run test:db` through `mcproc exec` from the mcproc manifest (`http://127.0.0.1:5191`,
  `http://127.0.0.1:8010`, `http://127.0.0.1:1090` and `https://localhost:5493` in the main
  checkout). First, a session the gateway opened at an email's first verification stays live
  after the stand was opened as its operator. Each test
  plays the front for a simulated client of its own (`__fixtures__/simulated-front.ts`): its
  calls carry `X-Forwarded-For: 198.18.<a>.<b>` from a hash of the test's name, so the gateway's
  limit of 20 sign-ups and sign-ins per client address in 10 s counts each test apart, and the
  front's origin in `Origin`, as a browser's do: Node's fetch marks its requests as a browser's,
  and the gateway's sign-up and sign-in then want the front's origin. It sweeps
  only the demo accounts (and one outsider and one key-holder account) it seeds, so the other
  suites on the stand keep theirs.
