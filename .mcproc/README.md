# Local stands

- `surrealdb-dev` (profile `dev`): in-memory SurrealDB on 127.0.0.1:8000 for development.
- `surrealdb-e2e` (profile `e2e`): in-memory SurrealDB on 127.0.0.1:8010 for `bun run test:db`
  and the e2e launcher. Restart it to get an empty database, then restart `gateway-e2e`, which
  defines its namespace user on the stand when it starts.

- `gateway` (profile `dev`) and `gateway-e2e` (profile `e2e`): the gateway on 127.0.0.1:5181 and
  127.0.0.1:5191. Each waits until its SurrealDB answers, runs `scripts/stand-operator.ts` (the
  namespace `app`, the database `directory` and the user `gateway`), then serves with
  `bun --watch`, reloading on source changes.

- `web` (profile `dev`, kind `build`): the web application's build watcher, `vite build
  --watch` in development mode. It listens on no port: every source change rewrites
  `apps/web/dist` in 1-3 s (`mcproc wait web --until log:built` after an edit), and a reload of
  the page shows it. Each signed-in identity's database runs in the browser; signing up or in
  and syncing go through the gateway under `/backend/` of the same front.

- `caddy-dev` (profile `dev`) and `caddy-e2e` (profile `e2e`): Caddy in docker on
  https://localhost:5443 and https://localhost:5493, the build in `apps/web/dist` and, under
  `/backend/`, the gateway on one origin (`infra/dev/`). Open the stands there. `caddy-dev`
  starts after `web` and `gateway` (start order only) and answers 404 until the watcher's first
  build; the `e2e` profile has no web app of its own: `bun run test:e2e` writes the production
  build, then starts the profile with `--reload` (apps already online restart, so a run never
  meets a stale stand) and waits for it.

Both SurrealDB stands run the `surrealdb/surrealdb:v3.3.4` image with root/root credentials and
no persistence. Apps in containers (SurrealDB, Caddy) declare only a url: their ports are held
outside the app's processes, so wait until `url-ok`. `surreal sql --endpoint
http://127.0.0.1:8010 --user root --pass root` opens a shell against the e2e stand.

`mcproc start <profile> --reload` restarts the apps already online (a restarted Caddy reads the
current Caddyfile; a restarted SurrealDB stand is empty). An app removed from the manifest is
unknown to mcproc afterwards; the pm2 process it leaves (`perch-<app>` in `pm2 ls`) goes with
`pm2 delete perch-<app>`, as `web-e2e`, the old e2e dev server, did.
