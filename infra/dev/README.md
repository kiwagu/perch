# Local front

Caddy in front of a local stand, so the browser sees one https origin: the web app's build at
`/`, the gateway under `/backend/` (the prefix is stripped, WebSocket upgrades pass through for
the gateway's `/sync`). No dev server runs behind it.

- `compose.yaml`: one service per stand, run by the mcproc apps of the same names:
  `caddy-dev` (https://localhost:5443, gateway 5181) and `caddy-e2e` (https://localhost:5493,
  gateway-e2e 5191). Both mount `apps/web/dist` read-only at `/srv/web`: on the dev stand the
  `web` watcher keeps it current, before an e2e run the launcher writes the production build
  there. Host networking lets Caddy reach the gateways; each site binds 127.0.0.1 only.
- `Caddyfile.dev`, `Caddyfile.e2e`: a file server for a single-page app over `/srv/web`, with
  zstd or gzip encoding. A path that is not a file gets `index.html`, so a deep link such as
  `/me` opens the app. `/assets/*` (Vite's content-hashed files) are sent with
  `Cache-Control: public, max-age=31536000, immutable`; `index.html` (at `/`, by name or for
  a deep link) with `Cache-Control: no-cache`, so a reload after a rebuild loads the new build.
  `.wasm` files go out as `application/wasm`.
- `make-certs.sh`: writes `certs/localhost.pem` and `certs/localhost-key.pem` (gitignored) once.
  With mkcert installed the certificate is mkcert's, which browsers trust after `mkcert -install`;
  otherwise openssl makes a self-signed one. Delete `certs/` to make new ones.
- The stand operator, `scripts/stand-operator.ts` with `scripts/stand-operator.surql`, connects
  to a SurrealDB stand as its root user and defines the namespace `app`, its database `directory`
  and the gateway's namespace user (role OWNER, no root account). The gateway's mcproc apps run it
  before each start; every statement may run again. Its password, `gateway-stand-password`, is a
  literal for the local in-memory stands only; a real deployment defines the gateway's user by
  hand with a password of its own.
