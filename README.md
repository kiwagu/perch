# Perch

A foundation for local-first applications on SurrealDB and Loro: each device keeps its own
database, and a gateway keeps it in sync with the central SurrealDB.

## Prerequisites

- Bun 1.4.3 (`packageManager` in `package.json`), then `bun install` at the root.
- Docker with Compose v2 or later (`docker compose`): the stands run SurrealDB and Caddy in
  containers.
- mcproc (`npm i -g mcproc`): it starts and stops the stands from `.mcproc/mcproc.yaml`. The
  mcproc profiles are the working path: `bun run dev` alone starts the dev servers without the
  gateway's environment and its database.
- mkcert with `mkcert -install`, so the browser trusts the stands' https front; without it a
  self-signed certificate is made, and the browser asks to accept it once.
- `bunx playwright install` for the browsers the e2e specs run in.
- The SurrealDB CLI (`surreal`) for the git hooks that validate staged `.surql` files.
- Screenshot baselines of the e2e specs are git-ignored and rebuilt per machine: the first run
  writes them. A machine that kept baselines from an older layout rebuilds them with
  `bun run test:e2e -- --update-snapshots=changed`.

## Local stands

A stand is SurrealDB in memory, the gateway, the web app's Vite dev server and a Caddy front
(`infra/dev/`) that serves the app and, under `/backend/`, the gateway on one https origin.
The processes are declared in `.mcproc/mcproc.yaml` and driven by mcproc (pm2 underneath).

| Stand | Profile | Open | SurrealDB | Gateway | Web |
|---|---|---|---|---|---|
| development | `dev` | https://localhost:5443 | 127.0.0.1:8000 | 127.0.0.1:5181 | 127.0.0.1:5180 |
| tests | `e2e` | https://localhost:5493 | 127.0.0.1:8010 | 127.0.0.1:5191 | 127.0.0.1:5190 |

- `mcproc start dev`, then open https://localhost:5443; `mcproc stop dev` stops the stand. The
  gateway waits for its database and defines its namespace user there before it starts.
- `bun run test:db`: the schema permission suites, the seed and the gateway smoke test against
  the e2e stand (start it first with `mcproc start e2e`). `SURREAL_URL=http://<host>:<port>`
  points them at another stand, and `GATEWAY_URL=http://<host>:<port>` the seed at its gateway.
- `bun run seed`: the demo accounts, seeded through the dev stand's gateway.
- `CI=1 bun run test:e2e`: builds, starts the `e2e` profile, waits for each of its apps and runs
  the Playwright specs through the front; `bun run test:e2e --down` stops the profile.
- A SurrealDB stand keeps nothing when it stops. After restarting one on its own, restart its
  gateway too (`mcproc restart gateway-e2e`), so the gateway's user is defined again.

## Workspaces

Each workspace has a README with its role, key exports and commands.

- `apps/web`: the browser application; each signed-in identity's local replica in its own
  IndexedDB database, synced through the gateway by one leading tab per browser.
- `apps/gateway`: the Bun server in front of the central SurrealDB: sign-up and sign-in over
  HTTP, sync over a WebSocket.
- `packages/replica`: Loro region documents, the projector into the local database, the
  sync protocol, the server's region log, batch validation and hub, and the device's sync engine.
- `packages/data`: the SurrealDB driver: local databases, shapes and commands, accounts.
- `packages/modeling`: the build-time stage that compiles `.surql` files into typed models.
- `database`: the shared schema, its permission suites and the generated replica schema.
- `seed`: demo accounts seeded through the gateway like any device, and their sweep.
- `tests/e2e`: Playwright specs on a phone and a desktop against the `e2e` stand.
- `packages/{cqrs,di,e2e-spec,eslint-config,i18n,ids,kernel,logger,ui,zod}`: the buses, the
  container, the e2e spec tooling, lint rules, translations, entity ids, the domain kernel, the
  logger, the UI kit and the single Zod instance.

## Gates

- `bun run check`: type checks, lint, unit tests and the model, i18n, refactor, README and e2e
  coverage checks; the gate for a change. `bun run check --force` runs every task afresh
  instead of replaying turbo's cache.
- `bun run test:db` with the `e2e` stand up: the schema permission suites, the seed and the
  gateway smoke test.
- `CI=1 bun run test:e2e`: the Playwright specs, one worker.

## Commands

- `bun run build`: production builds, leaving two cores free (`BUILD_RESERVED_CORES`).
- `bun run model`: regenerate the models, page model, permission suites and replica schema.
- `bun run seed` and `bun run seed:sweep`: seed the dev stand through its gateway, or remove
  the seed data.
- `bun run refactor:scan`: files that have grown past the size thresholds.
- `bun run --filter @workspace/replica measure` and `measure:validation`: the replica's write
  path and what checking a pushed batch costs the server, on this machine.
