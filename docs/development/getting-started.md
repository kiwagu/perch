# Getting started

## Prerequisites

- Bun 1.4.3 (`packageManager` in `package.json`), then `bun install` at the root, which also
  installs the git hooks.
- Docker with Compose v2 or later (`docker compose`): the stands run SurrealDB, MailDev and Caddy
  in containers.
- mcproc 0.13.0 or later (`npm i -g mcproc`): it starts and stops the stands from
  `.mcproc/mcproc.yaml`, with the manifest's variables, memory leases and worktrees. The
  mcproc profiles are the working path: `bun run dev` alone starts the web app's build watcher
  and the gateway without the gateway's environment, its database or the front.
- mkcert with `mkcert -install`, so the browser trusts the stands' https front; without it a
  self-signed certificate is made, and the browser asks to accept it once.
- `bunx playwright install` for the browsers the e2e specs run in.
- The SurrealDB CLI (`surreal`) for the git hooks that validate staged `.surql` files.
- Screenshot baselines of the e2e specs are git-ignored and rebuilt per machine: the first run
  writes them. A machine that kept baselines from an older layout rebuilds them with
  `bun run test:e2e -- --update-snapshots=changed`.

## The first run

A stand is SurrealDB in memory, the gateway, a MailDev mailbox and a Caddy front that serves a
web app build and, under `/backend/`, the gateway on one https origin; the browser talks to
nothing else. Two stands run per checkout:

| Stand | Profile | Open | Mailbox | SurrealDB | Gateway | Web app |
|---|---|---|---|---|---|---|
| development | `dev` | https://localhost:5443 | http://127.0.0.1:1080 | 127.0.0.1:8000 | 127.0.0.1:5181 | build watcher |
| tests | `e2e` | https://localhost:5493 | http://127.0.0.1:1090 | 127.0.0.1:8010 | 127.0.0.1:5191 | production build |

These are the main checkout's addresses; a worktree runs the same stands with every port
shifted. [.mcproc/README.md](../../.mcproc/README.md) describes each app of the stands and the
worktrees, and [infra/dev/README.md](../../infra/dev/README.md) the front and the mailbox.

1. `mcproc start dev`, then open https://localhost:5443; `mcproc stop dev` stops the stand. The
   web app is a build watcher, not a dev server, so there is no hot module replacement: after a
   code change it rewrites the build in 1-3 s, and a reload of the page shows it.
2. Sign up in the app. Every mail the stand's gateway sends lands in its mailbox, whose web UI,
   http://127.0.0.1:1080, shows the verification mail; its link signs the device in.
3. `bun run seed --reset` seeds the demo accounts and the organisation `acme`, with `ann` as its
   administrator and `beto` as a member (the passwords are in [seed/README.md](../../seed/README.md)).
   Sign in as either one and open `/org` in the app: the organisation's name, your role and its
   shared notes; a note written by one member reaches the other's open page. The e2e scenarios
   of `tests/e2e/scenarios/organisation/flows/` cover the sharing, an outsider, a change of
   membership and who may edit which note across two accounts, and the gateway smoke test
   (`bun run test:db`) drives the organisation routes and the tenant region on the e2e stand.
4. `bun run check` is the gate for a change; [commands.md](commands.md) lists it with the
   suites that run on the e2e stand and the other commands.
