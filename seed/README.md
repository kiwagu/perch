# Seed (`@workspace/seed`)

## Role in the architecture

Seed data created through the product path rather than by SurrealQL inserts: a seed
client is a device of the application running in Bun or Node (its composition root over an
in-memory database), so an account is signed up through the gateway's HTTP routes and its
profile is written by the user module's services, the command bus and the Loro write path,
then synced to the gateway over its WebSocket like any device's changes. The seed waits
until the gateway has acknowledged everything and leaves each account without signing it
out. Removing seed data is an operator task on a stand instead: the sweep connects to the
stand's SurrealDB as a system user on the gateway's database. All seed data uses addresses
on `example.test`, which is how the sweep finds it. The catalog is standalone, so e2e tests
generate their data from the same presets. Organisations are seeded after every account
exists: the administrator signs in, creates the organisation (the key `acme`; a `fresh` seed
suffixes the run id, `acme_<run>`) and invites the members by email.

## Key exports

- `catalog`, `accountFor(preset, mode)`, `organisationFor(preset, mode)`, `validateCatalog()`,
  `SEED_EMAIL_DOMAIN`: the presets (name, bio and language; organisations with their key,
  administrator and members, by account ref), the account data for a `demo` (same address every run) or `fresh`
  (new address per run) seed, and the offline check of the catalog; `./catalog` exports them
  alone, without the gateway client, for the e2e tests.
- `runSeed(options)`: seeds every preset through the gateway at `gatewayUrl` and returns
  the manifest (`accounts`: ref to account id, email and profile id; `organisations`: ref to
  organisation id, key and name); `demo` is idempotent, and `reset` sweeps the stand first.
- `sweep(target, { emails? })`: removes the seeded accounts (or only those at `emails`)
  with the organisations they created (their databases `t_<key>`, memberships and directory
  rows), their profiles and the server's copy of their regions (`_replica_head`,
  `_replica_snapshot`, `_replica_update`, `_replica_projected`). Of a region the gateway
  keeps in memory only what a connected device subscribed to, unloaded 60 s after the last
  device left. Re-creating an organisation under the key of a swept one works: the gateway
  opens a new connection to its database. Sweep only once the seed clients have left (`runSeed` closes its client
  before it returns), or a device still connected keeps the swept region in the gateway.
- `openStand(target)`: the operator's connection to a stand that the sweep runs on.

## Commands

- `mcproc start dev && bun run seed` (from the repository root): seeds through the dev
  gateway (`http://127.0.0.1:5181`; `--gateway=<url>` or `GATEWAY_URL` for another one).
  Flags: `--fresh`, `--reset` (sweep first), `--manifest=<file>`. The stand behind the
  gateway is reached only by the sweep: `--url=` (default `http://127.0.0.1:8000`),
  `--namespace=` and `--database=` (default `app` and `directory`, the gateway's
  database), `--user=` and `--pass=` (default the stand's root). Demo accounts sign in
  with the password `<ref>-seed-password`.
- `bun run seed:sweep`: removes the seed data from the stand (same stand flags).
- `bun run test`: the offline catalog check.
- `bun run test:db`: seeding through the gateway, a second device reading what was
  seeded (the member's view of the organisation included), and the sweep, against the e2e stand (`mcproc start e2e` first): the gateway at
  `GATEWAY_URL` (default `http://127.0.0.1:5191`) and its SurrealDB at `SURREAL_URL`
  (default `http://127.0.0.1:8010`). It sweeps only the demo accounts (and one outsider
  account) it seeds, so the other suites on the stand keep theirs.
