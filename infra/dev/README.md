# Local front and mailbox

Caddy in front of a local stand, so the browser sees one https origin: the web app's build at
`/`, the gateway under `/backend/` (the prefix is stripped, WebSocket upgrades pass through for
the gateway's `/sync`). No dev server runs behind it. Beside it, MailDev is the stand's mailbox:
every mail the stand's gateway sends lands there, for people and the suites to read.

- `compose.yaml`: two services, `caddy` and `maildev`, each run by two mcproc apps per checkout
  (one per stand) under the checkout's compose project, with a container name of its own.
- `caddy`: the mcproc apps `caddy-dev` and `caddy-e2e` run it as
  `docker compose -p <project> run --rm --name <project>-caddy-<stand> caddy` with the stand's
  ports in `FRONT_PORT` and `GATEWAY_PORT` (the main checkout: https://localhost:5443 with the
  gateway on 5181, https://localhost:5493 with gateway-e2e on 5191; a worktree's slot shifts
  each by 100), the manifest switch in `PERCH_UI_MANIFEST` and the client address it names to
  the gateway in `PERCH_CLIENT_ADDRESS` (`peer` for `caddy-dev`, `claimed` for `caddy-e2e`: under
  `Caddyfile` below). The compose project and the container name carry the checkout's project slug,
  so two stands, or two checkouts, never share a container. The service mounts a web build
  read-only at `/srv/web`, the folder `WEB_DIST` names under `apps/web` (default `dist`): the
  dev stand passes `dist-dev`, which the `web` watcher keeps current; the e2e stand keeps
  `dist`, where the launcher writes the production build before each run. Host networking lets Caddy reach the
  gateways; the site binds 127.0.0.1 only.
- `maildev`: `maildev/maildev:2.2.1`, pinned by its digest: the last release of the 2.x line,
  whose REST API the suites are written against. The mcproc apps `maildev-dev` and
  `maildev-e2e` run it as `docker compose -p <project> run --rm --name <project>-maildev-<stand>
  maildev` with the stand's ports in `MAILDEV_SMTP_PORT` and `MAILDEV_WEB_PORT` (the main
  checkout: SMTP 1025 and web 1080 for the dev stand, SMTP 1035 and web 1090 for the e2e stand;
  a worktree's slot shifts each by 100). Host networking, with both the SMTP server and the web
  server bound to 127.0.0.1 only (`MAILDEV_IP`, `MAILDEV_WEB_IP`). The stand's gateway sends to
  its SMTP port; its web port serves the web UI, where a person opens the stand's mails, and the
  REST API the suites read through `@workspace/mailbox`: `GET /email` (filtered by
  `?to.address=<address>`), `GET /email/:id`, `GET /email/:id/html`, `DELETE /email/all` and
  `GET /healthz`, which the apps' readiness checks; the container's own health check asks it on
  127.0.0.1 too (the image's asks `localhost`, which resolves to `::1` first, where MailDev does
  not listen). Mails live in the container only: a restart of the app empties the mailbox, and
  the two stands never share one.
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
  The gateway counts its request limits by the client address, the rightmost
  `X-Forwarded-For` entry, which the front writes under `/backend/`: with `peer` (the default,
  and the dev stand's) the address the request came from, whatever a browser sent there.
  `caddy-e2e` runs with `claimed`: the request's `X-Perch-Client-Address` header is the
  entry, and is not passed on. Every browser of the e2e suite reaches the front from 127.0.0.1,
  so each Playwright worker claims an address of its own and spends its own limits; a request
  without the header leaves the entry empty, and the gateway takes the connection's address.
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
  Each gateway app's `GATEWAY_SMTP_URL` points at its own stand's MailDev
  (`smtp://127.0.0.1:1025` for the dev stand, `smtp://127.0.0.1:1035` for the e2e stand), and
  `GATEWAY_MAIL_FROM` is the manifest's `stand_mail_from` (`Perch <no-reply@example.test>`), a
  literal for the local stands only; a real deployment sets its own mail server and From.
