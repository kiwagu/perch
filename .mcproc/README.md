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

- `maildev-dev` (profile `dev`) and `maildev-e2e` (profile `e2e`): MailDev 2.2.1 in docker
  (`infra/dev/`), each stand's mailbox. The dev stand's gateway sends to SMTP 127.0.0.1:1025 and
  its web UI at http://127.0.0.1:1080 shows every mail (open a verification link from there);
  the e2e stand's gateway sends to SMTP 127.0.0.1:1035, and the suites read the mails through
  its REST API at http://127.0.0.1:1090. Both bind 127.0.0.1 only, keep the mails in the
  container (a restart empties the mailbox) and are ready once `/healthz` answers. `maildev-dev`
  is restarted on a change of the compose file. Each gateway waits for its stand's mailbox
  (`depends_on`).

- `gateway` (profile `dev`) and `gateway-e2e` (profile `e2e`): the gateway on 127.0.0.1:5181 and
  127.0.0.1:5191. Each waits until its SurrealDB answers, runs `scripts/stand-operator.ts` (the
  namespace `app`, the database `directory` and the user `gateway`), then serves. pm2 restarts
  it (`watch:`) on a change of its sources or of a workspace package it imports, a fresh process
  each time: a tree caught mid-edit fails one start, pm2 retries with a growing delay
  (`exp_backoff_restart_delay`), and the next change brings it back. Both run Better Auth with
  the manifest's stand-only secret, `stand_auth_secret` in `vars`, as `GATEWAY_AUTH_SECRET`, and
  each with its own front's origin as `GATEWAY_PUBLIC_URL` (https://localhost:5443 and
  https://localhost:5493), its own stand's MailDev as `GATEWAY_SMTP_URL`
  (smtp://127.0.0.1:1025 and smtp://127.0.0.1:1035) and the manifest's `stand_mail_from` as
  `GATEWAY_MAIL_FROM`.

- `web` (profile `dev`, kind `build`): the web application's build watcher, `vite build
  --watch` in development mode. It listens on no port: every source change rewrites
  `apps/web/dist-dev` in 1-3 s (`mcproc wait web --until log:built` after an edit), and a reload
  of the page shows it. The watcher reads its config only when it starts, so pm2 restarts it on
  a change of `vite.config.ts` (and the surql plugin it imports), `package.json` or `bun.lock`. Each signed-in identity's database runs in the browser; signing up or in
  and syncing go through the gateway under `/backend/` of the same front.

- `caddy-dev` (profile `dev`) and `caddy-e2e` (profile `e2e`): Caddy in docker on
  https://localhost:5443 and https://localhost:5493, a web build and, under `/backend/`, the
  gateway on one origin (`infra/dev/`). Open the stands there. `caddy-dev` serves the
  watcher's `apps/web/dist-dev`, starts after `web` and `gateway` (start order only), answers
  404 until the watcher's first build, and pm2 restarts it on a change of the Caddyfile or the
  compose file. `caddy-e2e` serves `apps/web/dist`, which only the e2e launcher writes, so the
  two stands never overwrite each other's build: the `e2e` profile has no web app of its own;
  `bun run test:e2e` writes the production build, then starts the profile with `--reload` (apps
  already online restart, so a run never meets a stale stand) and waits for it.

Both SurrealDB stands run the `surrealdb/surrealdb:v3.3.4` image with root/root credentials and
no persistence. Apps in containers (SurrealDB, MailDev, Caddy) declare only a url: their ports
are held outside the app's processes, so wait until `url-ok`. `surreal sql --endpoint
http://127.0.0.1:8010 --user root --pass root` opens a shell against the e2e stand.

Every app declares the memory it takes (`memory:`; `containers:` names the docker containers
counted with it) and `resources` keeps 4G for the host: a start that does not fit waits its turn
in the host's queue (`mcproc leases`). `mcproc exec -- <command>` runs a command with this
checkout's stand addresses and what the e2e stand's gateway runs with (`GATEWAY_AUTH_SECRET`,
`GATEWAY_PUBLIC_URL`, `GATEWAY_SMTP_URL` and `GATEWAY_MAIL_FROM`, so the smoke and the load test
run a gateway of their own on that stand with the same secret, front origin and mail server) in
its environment, with the mailboxes the suites, the smoke, the load test and the seed read the
links from: `MAILBOX_URL`, the e2e stand's MailDev REST API, and `MAILBOX_DEV_URL`, the dev
stand's (`exec.env`): `bun run test:db`, `bun run test:e2e`, `bun run seed` and `bun run
seed:sweep` go through it, the e2e run under a 4G lease of its own. The `worktree` section names
what a new worktree copies from the main checkout (the certificates, the local hook file, the
screenshot baselines) and how it installs.

`mcproc start <profile> --reload` restarts the apps already online (a restarted SurrealDB stand
is empty). pm2 keeps the command and the environment an app started with, so after a change of
this manifest (a landing included) the running apps it touches are made again from it:
`mcproc delete <app>`, then `mcproc start <app>`, leaves the dependencies that are online (and
the dev database) alone. An app removed from the manifest is
unknown to mcproc afterwards; the pm2 process it leaves (`<project>-<app>` in `pm2 ls`,
`perch-<app>` in the main checkout) goes with `pm2 delete perch-<app>`, as `web-e2e`, the old
e2e dev server, did.
