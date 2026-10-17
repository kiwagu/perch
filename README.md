# Perch

A foundation for local-first applications on SurrealDB and Loro: each device keeps its own
database, and a gateway keeps it in sync with the central SurrealDB.

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
  points them at another stand.
- `CI=1 bun run test:e2e`: builds, starts the `e2e` profile, waits for each of its apps and runs
  the Playwright specs through the front; `bun run test:e2e --down` stops the profile.
- A SurrealDB stand keeps nothing when it stops. After restarting one on its own, restart its
  gateway too (`mcproc restart gateway-e2e`), so the gateway's user is defined again.

## Checks

- `bun run check`: type checks, lint, unit tests and the model, i18n, README and e2e coverage
  checks; the gate for a change.
