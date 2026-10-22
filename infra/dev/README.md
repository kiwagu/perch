# Local front

Caddy in front of a local stand, so the browser sees one https origin: the web app at `/`
(the Vite dev server on the dev stand, the production build on the e2e stand), the gateway
under `/backend/` (the prefix is stripped, WebSocket upgrades pass through for the gateway's
`/sync` and the dev server's HMR socket).

- `compose.yaml`: one service, `caddy`, which the mcproc apps `caddy-dev` and `caddy-e2e` run as
  `docker compose -p <project> run --rm --name <project>-caddy-<stand> caddy` with the stand's
  ports in `FRONT_PORT` and `GATEWAY_PORT` (the main checkout: https://localhost:5443 with the
  gateway on 5181, https://localhost:5493 with gateway-e2e on 5191; a worktree's slot shifts
  each by 100), the manifest switch in `PERCH_UI_MANIFEST`, and what serves the web app in
  `WEB_SOURCE` (`dev` with the dev server's port in `WEB_DEV_PORT` for `caddy-dev`, `build`
  for `caddy-e2e`). The compose project and the container name carry the checkout's project
  slug, so two stands, or two checkouts, never share a container. The service mounts
  `apps/web/dist` read-only at `/srv/web`, which only the e2e launcher writes (the production
  build before each run). Host networking lets Caddy reach the gateways and the dev server; the
  site binds 127.0.0.1 only.
- `Caddyfile`: one site, `https://localhost:{$FRONT_PORT}`, with `/backend/*` proxied to
  `127.0.0.1:{$GATEWAY_PORT}`, both read from the container's environment, and the web app
  from the snippet `WEB_SOURCE` names. `web-dev` proxies everything else, the HMR socket and
  `/ui-manifest/*` included, to the dev server on `127.0.0.1:{$WEB_DEV_PORT}`. `web-build`
  (the default) is a file server for a single-page app over `/srv/web`, with zstd or gzip
  encoding. A path that is not a file gets
  `index.html`, so a deep link such as
  `/me` opens the app. `/assets/*` (Vite's content-hashed files) are sent with
  `Cache-Control: public, max-age=31536000, immutable`; `index.html` (at `/`, by name or for
  a deep link) with `Cache-Control: no-cache`, so a reload after a rebuild loads the new build.
  `.wasm` files go out as `application/wasm`. `/ui-manifest/*` is the UI manifest
  (`manifest.json`, `manifest.schema.json`, `model.schema.json`; the build writes it into
  `dist/ui-manifest/`, the dev server serves it from its cache), sent with
  `Cache-Control: no-store` and never answered with `index.html`; with `PERCH_UI_MANIFEST=0`
  (default `1`) it answers 404 instead on either source. The mcproc
  manifest passes the switch to both fronts from its var `ui_manifest` (`'1'`); a checkout turns
  it off with `ui_manifest: '0'` under `vars` in `.mcproc/mcproc.local.yaml`, then
  `mcproc restart caddy-dev` (or `caddy-e2e`).
- `make-certs.sh`: writes `certs/localhost.pem` and `certs/localhost-key.pem` (gitignored) once.
  With mkcert installed the certificate is mkcert's, which browsers trust after `mkcert -install`;
  otherwise openssl makes a self-signed one. Delete `certs/` to make new ones.
- The stand operator, `scripts/stand-operator.ts` with `scripts/stand-operator.surql`, connects
  to a SurrealDB stand as its root user and defines the namespace `app`, its database `directory`
  and the gateway's namespace user (role OWNER, no root account). The gateway's mcproc apps run it
  before each start; every statement may run again. Its password, `gateway-stand-password`, is a
  literal for the local in-memory stands only; a real deployment defines the gateway's user by
  hand with a password of its own. So is the key the stands' gateways sign tokens with
  (`GATEWAY_JWT_KEY`): a literal of the mcproc manifest, `stand_jwt_key` in its `vars`, given to
  both gateway apps and to `mcproc exec`, for the local stands only; a real deployment sets a key
  of its own (`openssl rand -hex 64`, one line of 128 characters).
