# Local stands

The addresses below are the main checkout's: the manifest's `vars` derive every port from
`slot` (0 here). A worktree made with `mcproc worktree add` gets its own slot through this
folder's gitignored `mcproc.local.yaml`, every port shifted by 100 per slot, and its project
slug (`perch-w1`) on its containers and pm2 names; `mcproc describe` prints the resolved values
of the checkout it runs in.

- `surrealdb-dev` (profile `dev`): in-memory SurrealDB on 127.0.0.1:8000 for development.
- `surrealdb-e2e` (profile `e2e`): in-memory SurrealDB on 127.0.0.1:8010 for `bun run test:db`
  and the e2e launcher. Restart it to get an empty database, then restart `gateway-e2e`, which
  defines its namespace user on the stand when it starts.

- `gateway` (profile `dev`) and `gateway-e2e` (profile `e2e`): the gateway on 127.0.0.1:5181 and
  127.0.0.1:5191. Each waits until its SurrealDB answers, runs `scripts/stand-operator.ts` (the
  namespace `app`, the database `directory` and the user `gateway`), then serves. pm2 restarts
  it (`watch:`) on a change of its sources or of a workspace package it imports, a fresh process
  each time: a tree caught mid-edit fails one start, pm2 retries with a growing delay
  (`exp_backoff_restart_delay`), and the next change brings it back. Both sign tokens with the
  manifest's stand-only key, `stand_jwt_key` in `vars`, as `GATEWAY_JWT_KEY`.

- `web` (profile `dev`): the web application's Vite dev server on 127.0.0.1:5180, opened
  through `caddy-dev`, which hands it the HMR socket too: an edit reaches the open page as a hot
  update, an edit of `apps/web/vite.config.ts` restarts the server by itself, and pm2 restarts
  it on a change of `bun.lock` or of the surql plugin the config imports. It serves the UI
  manifest, rebuilt on a change under `contract/` or `tests/e2e/scenarios/`. Each signed-in
  identity's database runs in the browser; signing up or in and syncing go through the gateway
  under `/backend/` of the same front.

- `caddy-dev` (profile `dev`) and `caddy-e2e` (profile `e2e`): Caddy in docker on
  https://localhost:5443 and https://localhost:5493, the web app and, under `/backend/`, the
  gateway on one origin (`infra/dev/`). Open the stands there. `caddy-dev` proxies to the dev
  server (`WEB_SOURCE=dev`), starts after `web` and `gateway` (start order only), answers 502
  until the dev server listens, and pm2 restarts it on a change of the Caddyfile or the compose
  file. `caddy-e2e` serves the production build in `apps/web/dist`, which only the e2e launcher
  writes: the `e2e` profile has no web app of its own; `bun run test:e2e` writes the build, then
  starts the profile with `--reload` (apps already online restart, so a run never meets a stale
  stand) and waits for it.

Both SurrealDB stands run the `surrealdb/surrealdb:v3.3.4` image with root/root credentials and
no persistence. Apps in containers (SurrealDB, Caddy) declare only a url: their ports are held
outside the app's processes, so wait until `url-ok`. `surreal sql --endpoint
http://127.0.0.1:8010 --user root --pass root` opens a shell against the e2e stand.

Every app declares the memory it takes (`memory:`; `containers:` names the docker containers
counted with it) and `resources` keeps 4G for the host: a start that does not fit waits its
turn in the host's queue (`mcproc leases`). `mcproc exec -- <command>` runs a command with
this checkout's stand addresses and the stands' signing key (`GATEWAY_JWT_KEY`, so the smoke,
the load test and the seed's sweep open a stand's directory with its gateway's key) in its
environment (`exec.env`): `bun run test:db`, `bun run test:e2e`, `bun run seed` and `bun run
seed:sweep` go through it, the e2e run under a 4G lease of its own. The `worktree` section
names what a new worktree copies from the main checkout (the certificates, the local hook file,
the screenshot baselines) and how it installs.

`mcproc start <profile> --reload` restarts the apps already online (a restarted SurrealDB stand
is empty). pm2 keeps the command and the environment an app started with, so after a change of
this manifest (a landing included) the running apps it touches are made again from it:
`mcproc delete <app>`, then `mcproc start <app>`, leaves the dependencies that are online (and
the dev database) alone. An app removed from the manifest is
unknown to mcproc afterwards; the pm2 process it leaves (`<project>-<app>` in `pm2 ls`,
`perch-<app>` in the main checkout) goes with `pm2 delete perch-<app>`, as `web-e2e`, the old
e2e dev server, did.
