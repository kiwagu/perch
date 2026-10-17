# Local stands

- `surrealdb-dev` (profile `dev`): in-memory SurrealDB on 127.0.0.1:8000 for development.
- `surrealdb-e2e` (profile `e2e`): in-memory SurrealDB on 127.0.0.1:8010 for `bun run test:db`
  and the e2e launcher. Restart it to get an empty database, then restart `gateway-e2e`, which
  defines its namespace user on the stand when it starts.

- `gateway` (profile `dev`) and `gateway-e2e` (profile `e2e`): the gateway on 127.0.0.1:5181 and
  127.0.0.1:5191. Each waits until its SurrealDB answers, runs `scripts/stand-operator.ts` (the
  namespace `app`, the database `directory` and the user `gateway`), then serves with
  `bun --watch`, reloading on source changes.

- `web` (profile `dev`): the web application's Vite dev server on 127.0.0.1:5180. The
  database runs in the browser, so signing up and editing the profile need no server.

- `web-e2e` (profile `e2e`): the same dev server on 127.0.0.1:5190 for the Playwright
  runs; `bun run test:e2e` starts and waits for the whole `e2e` profile.

- `caddy-dev` (profile `dev`) and `caddy-e2e` (profile `e2e`): Caddy in docker on
  https://localhost:5443 and https://localhost:5493, the page and, under `/backend/`, the
  gateway on one origin (`infra/dev/`). Open the stands there.

Both SurrealDB stands run the `surrealdb/surrealdb:v3.3.4` image with root/root credentials and
no persistence. Apps in containers (SurrealDB, Caddy) declare only a url: their ports are held
outside the app's processes, so wait until `url-ok`. `surreal sql --endpoint
http://127.0.0.1:8010 --user root --pass root` opens a shell against the e2e stand.
