# Local front

Caddy in front of a local stand, so the browser sees one https origin: the web app's build at
`/`, the gateway under `/backend/` (the prefix is stripped, WebSocket upgrades pass through for
the gateway's `/sync`). No dev server runs behind it.

- `compose.yaml`: one service, `caddy`, which the mcproc apps `caddy-dev` and `caddy-e2e` run as
  `docker compose -p <project> run --rm --name <project>-caddy-<stand> caddy` with the stand's
  ports in `FRONT_PORT` and `GATEWAY_PORT` (the main checkout: https://localhost:5443 with the
  gateway on 5181, https://localhost:5493 with gateway-e2e on 5191; a worktree's slot shifts
  each by 100), and the manifest switch in `PERCH_UI_MANIFEST`. The compose project and the container name carry the checkout's project slug,
  so two stands, or two checkouts, never share a container. The service mounts a web build
  read-only at `/srv/web`, the folder `WEB_DIST` names under `apps/web` (default `dist`): the
  dev stand passes `dist-dev`, which the `web` watcher keeps current; the e2e stand keeps
  `dist`, where the launcher writes the production build before each run. Host networking lets Caddy reach the
  gateways; the site binds 127.0.0.1 only.
- `Caddyfile`: one site, `https://localhost:{$FRONT_PORT}`, with `/backend/*` proxied to
  `127.0.0.1:{$GATEWAY_PORT}`, both read from the container's environment; a file server for a
  single-page app over `/srv/web`, with zstd or gzip encoding. A path that is not a file gets
  `index.html`, so a deep link such as
  `/me` opens the app. `/assets/*` (Vite's content-hashed files) are sent with
  `Cache-Control: public, max-age=31536000, immutable`; `index.html` (at `/`, by name or for
  a deep link) with `Cache-Control: no-cache`, so a reload after a rebuild loads the new build.
  `.wasm` files go out as `application/wasm`. `/ui-manifest/*` is the UI manifest the web
  build writes into its folder's `ui-manifest/` (`dist/` for the e2e stand, `dist-dev/` for
  the dev stand; `manifest.json`, `manifest.schema.json`,
  `model.schema.json`), sent with `Cache-Control: no-store` and never answered with
  `index.html`; with `PERCH_UI_MANIFEST=0` (default `1`) it answers 404 instead. The mcproc
  manifest passes the switch to both fronts from its var `ui_manifest` (`'1'`); a checkout turns
  it off with `ui_manifest: '0'` under `vars` in `.mcproc/mcproc.local.yaml`, then
  `mcproc restart caddy-dev` (or `caddy-e2e`). Every response carries the browser security
  headers of the snippet `security-headers`, each with its reason beside it: a
  Content-Security-Policy that allows only this origin's scripts, styles, fonts, web app
  manifest, worker, fetches and WebSocket, plus WASM compilation (`'wasm-unsafe-eval'`, never `'unsafe-eval'`),
  and no framing; `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, a
  `Permissions-Policy` that turns off what the app does not use, and
  `X-Content-Type-Options: nosniff`. No `Strict-Transport-Security`: it binds the whole host,
  so from `https://localhost` it would force https on every local port; a deployed front sends
  it for its own domain. The e2e fixtures hold every document and script to these values.
- `make-certs.sh`: writes `certs/localhost.pem` and `certs/localhost-key.pem` (gitignored) once.
  With mkcert installed the certificate is mkcert's, which browsers trust after `mkcert -install`;
  otherwise openssl makes a self-signed one. Delete `certs/` to make new ones.
- The stand operator, `scripts/stand-operator.ts` with `scripts/stand-operator.surql`, connects
  to a SurrealDB stand as its root user and defines the namespace `app`, its database `directory`
  and the gateway's namespace user (role OWNER, no root account). The gateway's mcproc apps run it
  before each start; every statement may run again. Its password, `gateway-stand-password`, is a
  literal for the local in-memory stands only; a real deployment defines the gateway's user by
  hand with a password of its own. So is the secret the stands' gateways run Better Auth with
  (`GATEWAY_AUTH_SECRET`): a literal of the mcproc manifest, `stand_auth_secret` in its `vars`,
  given to both gateway apps and to `mcproc exec`, for the local stands only; a real deployment
  sets a secret of its own (`openssl rand -hex 32`, at least 32 characters). Each gateway app
  also gets its own front's origin as `GATEWAY_PUBLIC_URL`, and `mcproc exec` the e2e front's.
