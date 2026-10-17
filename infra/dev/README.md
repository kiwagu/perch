# Local front

Caddy in front of a local stand, so the browser sees one https origin: the web app's dev
server at `/`, the gateway under `/backend/` (the prefix is stripped). WebSocket upgrades pass
through, the gateway's `/sync` and the dev server's HMR socket alike.

- `compose.yaml`: one service per stand, run by the mcproc apps of the same names:
  `caddy-dev` (https://localhost:5443: web 5180, gateway 5181) and `caddy-e2e`
  (https://localhost:5493: web-e2e 5190, gateway-e2e 5191). Host networking lets Caddy reach
  the dev servers; each site binds 127.0.0.1 only.
- `make-certs.sh`: writes `certs/localhost.pem` and `certs/localhost-key.pem` (gitignored) once.
  With mkcert installed the certificate is mkcert's, which browsers trust after `mkcert -install`;
  otherwise openssl makes a self-signed one. Delete `certs/` to make new ones.
- The stand operator, `scripts/stand-operator.ts` with `scripts/stand-operator.surql`, connects
  to a SurrealDB stand as its root user and defines the namespace `app`, its database `directory`
  and the gateway's namespace user (role OWNER, no root account). The gateway's mcproc apps run it
  before each start; every statement may run again. Its password, `gateway-stand-password`, is a
  literal for the local in-memory stands only; a real deployment defines the gateway's user by
  hand with a password of its own.
