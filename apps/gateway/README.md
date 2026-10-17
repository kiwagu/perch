# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. It listens on `127.0.0.1` at `GATEWAY_PORT`. Its HTTP
routes sign devices up and in (`POST /auth/sign-up`, `POST /auth/sign-in`, answering
`{ identity, tokens }`), each call on a database session of its own that is closed when
the call ends; `GET /health` answers `ok`. Devices sync over a WebSocket at `/sync`: a
device says hello with its keys (the pair is renewed with the refresh key when the access
token no longer works, and the new pair is sent first), is welcomed with its identity's
private region, the only region it may name, and subscribes, pulls, pushes, probes and
compacts there through the region hub, the server's copy of the replicated regions, which
answers it and sends each accepted batch to the identity's other devices. Text the
protocol refuses (4400), refused keys (4401), a foreign region (4403) and a hello that did
not come within 10 seconds (4408, after which the device connects again) close the socket
with the protocol's close codes; a device's sign-out leaves its regions, revokes its refresh
grant through the database's RPC and closes the socket with 4000, which means the grant is
revoked; a revoke that fails is tried once more, and a grant that still cannot be revoked
closes the socket with 1011 (`revoke failed`) instead. A renewed pair the socket closed
before it could take is logged at warn as `renewed pair not delivered`. Keys, tokens and
grant ids never reach its logs.

Organisations live in the same namespace, each in a strict database `t_<key>` of its own that
the gateway defines; the directory holds each organisation (`tenant`) and who belongs to it
(`membership`), and the organisation's database holds its `member` rows. Two services in
`src/tenants` serve them, and no route calls them so far. `TenantDatabases` keeps one
connection per organisation database in use, shared by every holder and closed once nobody has
held it for five minutes. `Organisations` creates an organisation (its directory rows, its
database, its creator as admin member there, then ready; a creation its creator left unfinished
is completed when the creator asks again), lists an identity's memberships in ready
organisations by key, lets an admin invite an existing identity by email and remove a member
other than itself, lists the members with their emails to any member, answers what it refuses
with a refusal code (`invalid-key`, `key-taken`, `not-admin`, `already-member` and the like), and
tells its listeners an identity's new memberships whenever they change.

## Key exports

None: this is an application. Its entry point is `src/index.ts`, which registers the
`.surql` loader and runs `src/main.ts`; `SIGINT` and `SIGTERM` stop the server and close
the database. The environment it reads is `GATEWAY_PORT`, `SURREAL_URL` (the database's
WebSocket endpoint, `ws://` or `wss://`, such as `ws://127.0.0.1:8000/rpc`),
`GATEWAY_SURREAL_USER`, `GATEWAY_SURREAL_PASS`, and optionally the logger's `LOG_LEVEL`
and `LOG_FORMAT`. `scripts/smoke.ts` is the entry point of the smoke test against a
stand.

## Commands

- `bun run dev`: runs the gateway and restarts it on changes.
- `bun run test`: unit and functional tests on embedded in-memory databases: the directory, and
  one per organisation for the organisation services.
- `bun run test:db`: the smoke test. It starts the gateway in its own process on a free
  port in front of the stand at `SURREAL_URL` (an `http(s)://` address becomes the
  WebSocket endpoint; by default the e2e stand, `ws://127.0.0.1:8010/rpc`) as
  `GATEWAY_SURREAL_USER` with `GATEWAY_SURREAL_PASS` (by default the user the stand
  operator defines, `scripts/stand-operator.ts` at the repository root), signs up a new
  `@example.test` identity and drives two of its devices through sync and sign-out, one
  line per step.
- `bun run typecheck`, `bun run lint`.
