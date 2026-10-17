# Perch

A foundation for local-first applications on SurrealDB and Loro: each device keeps its own
database, and a gateway keeps it in sync with the central SurrealDB.

## Prerequisites

- Bun 1.4.3 (`packageManager` in `package.json`), then `bun install` at the root.
- Docker with Compose v2 or later (`docker compose`): the stands run SurrealDB and Caddy in
  containers.
- mcproc (`npm i -g mcproc`): it starts and stops the stands from `.mcproc/mcproc.yaml`. The
  mcproc profiles are the working path: `bun run dev` alone starts the web app's build watcher
  and the gateway without the gateway's environment, its database or the front.
- mkcert with `mkcert -install`, so the browser trusts the stands' https front; without it a
  self-signed certificate is made, and the browser asks to accept it once.
- `bunx playwright install` for the browsers the e2e specs run in.
- The SurrealDB CLI (`surreal`) for the git hooks that validate staged `.surql` files.
- Screenshot baselines of the e2e specs are git-ignored and rebuilt per machine: the first run
  writes them. A machine that kept baselines from an older layout rebuilds them with
  `bun run test:e2e -- --update-snapshots=changed`.

## Local stands

A stand is SurrealDB in memory, the gateway and a Caddy front (`infra/dev/`) that serves the
web app's build (`apps/web/dist`) and, under `/backend/`, the gateway on one https origin; the
browser talks to nothing else. The processes are declared in `.mcproc/mcproc.yaml` and driven
by mcproc (pm2 underneath).

| Stand | Profile | Open | SurrealDB | Gateway | Web app |
|---|---|---|---|---|---|
| development | `dev` | https://localhost:5443 | 127.0.0.1:8000 | 127.0.0.1:5181 | build watcher |
| tests | `e2e` | https://localhost:5493 | 127.0.0.1:8010 | 127.0.0.1:5191 | production build |

These are the main checkout's addresses, slot 0 of the manifest's `vars`; a worktree made with
`mcproc worktree add` runs the same stands on a slot of its own, every port shifted by 100 per
slot, under its own project slug (`perch-w1`), so several checkouts run side by side (see
*Worktrees* below).

- `mcproc start dev`, then open https://localhost:5443; `mcproc stop dev` stops the stand. The
  gateway waits for its database and defines its namespace user there before it starts. The
  `web` app is a build watcher (`vite build --watch` in development mode, with source maps), not
  a dev server, so there is no hot module replacement: after a code change it rewrites
  `apps/web/dist` in 1-3 s, then reload the page. Until its first build finishes the front
  answers 404.
- `bun run test:db`: the schema permission suites, the seed and the gateway smoke test against
  the e2e stand (start it first with `mcproc start e2e`). The suites, the seed and the e2e
  launcher run through `mcproc exec`, which gives them this checkout's addresses (`SURREAL_URL`,
  `GATEWAY_URL` and `E2E_BASE_URL` of the e2e stand, `SURREAL_DEV_URL` and `GATEWAY_DEV_URL` of
  the dev stand); none of them has an address of its own.
- `bun run seed`: the demo accounts, seeded through the dev stand's gateway.
- `CI=1 bun run test:e2e`: builds (the web app's production build included), starts the `e2e`
  profile, waits for each of its apps and runs the Playwright specs through the front;
  `bun run test:e2e --down` stops the profile. Both fronts serve the one `apps/web/dist`, so
  after an e2e run the dev stand serves the production build until the watcher's next rebuild.
  The run holds a 4G memory lease for its build and browsers: when the host is short of
  memory it waits its turn (`mcproc leases` shows the queue).
- A SurrealDB stand keeps nothing when it stops. After restarting one on its own, restart its
  gateway too (`mcproc restart gateway-e2e`), so the gateway's user is defined again.

### Worktrees

A branch gets a checkout of its own, with stands of its own, next to the repository:

- `mcproc worktree add feat/x` (from the main checkout; `--from main` starts a new branch there)
  makes `../perch.worktrees/feat/x`, claims the next free slot, copies the local certificates,
  `lefthook-local.yml` and the screenshot baselines, runs `bun install` and writes
  `.mcproc/mcproc.local.yaml` there with the slot and the project slug (`perch-w1`). In that
  folder `mcproc start dev` brings the stand up on slot 1's ports (8100, 5281,
  https://localhost:5543), its containers and pm2 names prefixed `perch-w1-`; `bun run test:db`,
  `bun run seed` and `CI=1 bun run test:e2e` address that stand.
- A start asks the host for memory first: every app declares what it takes and the manifest
  keeps a reserve, so a stand that does not fit waits its turn (`mcproc ls` shows it as
  `queued`, `mcproc leases` shows the queue) and comes up by itself once memory frees.
- `mcproc worktree ls` lists the checkouts with their slots; `mcproc worktree remove feat/x`
  stops that checkout's apps, deletes the worktree and frees the slot (the branch stays).

## Organisations on the stand

`bun run seed --reset` (dev stand) seeds the organisation `acme` with `ann` as its administrator
and `beto` as a member, besides the demo accounts. Sign in as either one and open `/org` in the
app: the organisation's name, your role and its shared notes; a note written by one member
reaches the other's open page. The e2e specs in `tests/e2e/specs/organisation/` cover the
sharing, an outsider and a change of membership across two accounts, and the gateway smoke
test (`bun run test:db`) drives the organisation routes and the tenant region on the e2e stand.

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
