# Seed (`@workspace/seed`)

## Role in the architecture

Seed data for SurrealDB stands, created through the product path rather than by
SurrealQL inserts: the application's own composition root and user module run over a
remote engine as a system user, so an account is created by the access method's
sign-up and its profile by the command bus, the Loro write path and the projector.
All seed data uses addresses on `example.test`, which is how the sweep finds it.
The catalog is standalone, so e2e tests generate their data from the same presets.

## Key exports

- `catalog`, `accountFor(preset, mode)`, `validateCatalog()`: the presets, the account
  data for a `demo` (same address every run) or `fresh` (new address per run) seed, and
  the offline check of the catalog.
- `runSeed(options)`: seeds every preset into a stand and returns the manifest (ref to
  account id, email and profile id); `demo` is idempotent.
- `sweep(target)`: removes every seeded account with its profile and region documents.

## Commands

- `bun run seed` (from the repository root): seeds the dev stand
  (`http://127.0.0.1:8000`, the `surrealdb-dev` app). Flags: `--fresh`, `--reset`
  (sweep first), `--manifest=<file>`, `--url=`, `--namespace=`, `--database=`, `--user=`,
  `--pass=`. Demo accounts sign in with the password `<ref>-seed-password`.
- `bun run seed:sweep`: removes the seed data from the stand (same target flags).
- `bun run test`: the offline catalog check.
- `bun run test:db`: seeding and sweeping on the stand at `SURREAL_URL` (default
  `http://127.0.0.1:8010`, the `surrealdb-e2e` app), each run in its own database.
