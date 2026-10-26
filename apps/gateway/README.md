# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. It listens on `127.0.0.1` at `GATEWAY_PORT`. Its HTTP routes
sign devices up, in and out, list and sign out an identity's devices, and serve organisations
and their members; devices sync over a WebSocket at `/sync`; `GET /health` answers `ok`.

The source is one module per mechanism of the platform under `src/`, each with its own README
for its role, surface and commands. `src/server.ts` routes each request to its module and
`src/composition/root.ts` builds them; `src/keyed-turns.ts` runs one key's work one turn at a
time (one identity's membership changes, one device's key operations). The modules that
predate the index rule have no `index.ts` yet and are imported file by file.

- [auth](src/auth/README.md): sign-up, sign-in and sign-out, device sessions, tokens and the
  Bearer caller.
- [sync](src/sync/README.md): a device's WebSocket from hello to close, and the registry of open
  connections.
- [tenants](src/tenants/README.md): organisations, their databases, memberships and members,
  and their routes.
- [limits](src/limits/README.md): the request limits and the 429 they answer.

## Key exports

None: this is an application. Its entry point is `src/index.ts`, which registers the
`.surql` loader and runs `src/main.ts`; `SIGINT` and `SIGTERM` stop the server and close
the database. The environment it reads is `GATEWAY_PORT`, `SURREAL_URL` (the database's
WebSocket endpoint, `ws://` or `wss://`, such as `ws://127.0.0.1:8000/rpc`),
`GATEWAY_SURREAL_USER`, `GATEWAY_SURREAL_PASS`, `GATEWAY_JWT_KEY` (the signing key, below), and
optionally the logger's `LOG_LEVEL` and `LOG_FORMAT`; an invalid variable stops the gateway with
an issue that names it, never its value. `scripts/smoke/cli.ts` is the entry point of the smoke
test against a stand (the folder `scripts/smoke/`: the run, one module per path of steps, the
HTTP helpers the load test reuses).

Signing key: the identity access method signs every access token with `GATEWAY_JWT_KEY` (HS512),
which the gateway gives the directory schema when it applies it, so a schema applied again (at a
restart after a schema change, or on a deployment) keeps every issued token valid. It is
required, with no default and at least 64 characters: generate one with `openssl rand -hex 64`
(128 characters on one line).
The local stands use a literal of the mcproc manifest (`stand_jwt_key`), for those stands only;
everything else that opens a stand's directory (the smoke, the load test's gateway, the seed's
sweep) applies the schema with that same key, from `mcproc exec`, or it would give the stand a
key of its own.
To rotate it, set a new value and restart the gateway: the schema is applied again under the new
key, earlier access tokens are refused, and each device renews its pair once with its refresh
key at its next hello; nobody is signed out. The organisations' databases have no access method
of their own yet; when they get one, it takes its key from this variable too.

## Commands

- `bun run dev`: runs the gateway and restarts it on changes.
- `bun run test`: unit and functional tests on embedded in-memory databases: the directory, and
  one per organisation for the organisation services and routes.
- `bun run test:db`: the smoke test. It starts the gateway in its own process on a free
  port in front of the stand at `SURREAL_URL` (an `http(s)://` address becomes the
  WebSocket endpoint; `bun run test:db` at the repository root sets it through `mcproc exec`
  from the mcproc manifest: the e2e stand, `ws://127.0.0.1:8010/rpc` in the main checkout) as
  `GATEWAY_SURREAL_USER` with `GATEWAY_SURREAL_PASS` (by default the user the stand
  operator defines, `scripts/stand-operator.ts` at the repository root) and with
  `GATEWAY_JWT_KEY`, the key the stand's gateway signs with (required, no default; the root
  `bun run test:db` sets it from the manifest), signs up a new
  `@example.test` identity and drives two of its devices through sync and sign-out, then
  the organisation path (an organisation `smoke_<time>` created, a second identity invited,
  each device welcomed with its membership and role, the invited device writing a note into the
  organisation's region that the owner's device receives, the owner editing that note as an
  admin, the invited device deleting its own note, a late device of the owner subscribing to a
  snapshot that holds the admin's note and not the deleted one, the invited device's edit of
  the owner's note rejected as `forbidden-action`, a note in the owner's name rejected as
  `foreign-owner`, a note under the owner device's Loro peer rejected as `foreign-peer` with the
  owner's next note still acknowledged and delivered, the member list refused to it with 403,
  the removal that closes the region with 4403, and the removed identity's sign-out, after
  which its refresh key is refused with 4401), on a further identity the clause of the access method: its fresh token accepted, the
  same token refused once `sessions_revoked_at` is set after it, a refresh not blocked by it, and
  the namespace user revoking the identity's grants (`ACCESS identity ON DATABASE REVOKE`) so
  that the refresh is refused; on a further identity the directory schema applied again with the
  stand's key, the access token issued before it still accepted without a renewal; the limits of
  the credential routes, each from a device, so a simulated client address, of its own (21
  sign-ins of unknown emails within 10 s, the 21st answered 429 with `Retry-After`; 11 wrong
  passwords for a further identity, the 11th answered 429); the renewal limit of a device (11
  hellos of one device with a dead access token and a made-up refresh key within 15 minutes,
  the first 10 closed with 4401, the 11th with 1013, counted by the smoke's own gateway); and on
  another identity its device sessions: a hello under a
  device with no session closed with 4401 and a call without `X-Perch-Device` answered 400, a
  laptop and a phone listed by `GET /devices` with the laptop as current, the phone signed out
  from the laptop (`DELETE /devices/:id`, its socket closed with 4001, its row revoked, its hello
  with its still working access token closed with 4001) and signed in again in a later second
  (that old token refused at hello with 4401 and by `GET /devices` with 401, the new pair
  welcomed), a tablet signed in and
  then every device signed out from the laptop (`POST /auth/sign-out-everywhere`, the laptop's
  and the tablet's sockets closed with 4001, in a later second than every token issued before),
  a sign-in right after it answered 200 with a working token, the laptop's old pair refused at
  hello (4401) and by `POST /auth/sign-out` (401); one line per step.
- `bun run load`: the load test, see below (`bun run load -- <arguments>` at the repository
  root gives it the e2e stand through `mcproc exec`).
- `bun run typecheck`, `bun run lint`.

## Load test

`bun run load -- [arguments]` at the repository root drives simulated devices against a
gateway of its own: it starts `src/index.ts` as a child process on port 5197, in front of the
e2e stand's SurrealDB (`SURREAL_URL` from `mcproc exec`), and waits for its `/health`. Each step
signs up the devices it adds (`load-<run>-<n>@example.test`, each device from a simulated client
address of its own, as in the smoke), groups every `--members` of them
into an organisation `load_<run>_<k>` (the first creates it and invites the rest), opens their
devices on the organisation's region and then holds the load for `--hold` seconds. A fraction
`--writers` of the new devices are writers, spread over the step's organisations: each appends
a note every `1 / --rate` seconds, at a random phase, and proposes a compaction when an ack asks
for one. Writers are cumulative: those of earlier steps keep writing, so a row's `writers` is a
total. One table row is printed per step; a step's devices stay open for the next one.

| Argument | Default | Meaning |
|---|---|---|
| `--devices` | `100,500,1000,2000` | device totals of the steps, growing |
| `--members` | `20` | devices per organisation |
| `--writers` | `0.3` | share of the new devices that write |
| `--rate` | `0.1` | notes per second of one writer |
| `--hold` | `60` | seconds each step holds its load |
| `--gateway-port` | `5197` | port of the gateway the test starts; it must be free |
| `--surreal-container` | by the stand's port | container `docker stats` reads for the surreal columns; the default is `perch-surrealdb-e2e` for port 8010 of `SURREAL_URL`, `perch-w<slot>-surrealdb-e2e` for port 8010 + 100 x slot, none (the columns show `-`) for any other port |
| `--json <path>` | none | also writes the steps with the run id, arguments, host and start time |
| `--stop-on-degrade` | off | stops after the first degraded step |

Columns:

- `devices`, `writers`: live devices and writers in all (a device whose socket closed is
  retired and no longer counted). `ops/s` is nominal, writers times `--rate`; `pushes` is the
  number of pushes made during the hold.
- `ack p50/p95 ms`: from a push to its ack. `fanout p50/p95 ms (n)`: from a push to the arrival
  of its update at another device of the organisation, before that device imports it; `n` is
  the number of fan-out samples.
- `gw RSS MiB`, `gw CPU %`: the child gateway's resident memory at the step's end and its CPU
  time over the hold. `surreal CPU % / MiB`: the stand container from `docker stats` (`-` when
  docker cannot say).
- `compactions asked/accepted`: compactions the devices proposed after an ack asked for one,
  and those the server accepted.
- `errors`: server errors, rejected batches, failed imports, protocol problems and devices that
  could not open or get their snapshot; `closes`: sockets closed during the hold.
- `unacked`, `undelivered`: after the hold the step drains for up to 5 s (polling every
  100 ms) until every push has its ack and every acked push has reached the other live devices
  of its region; `unacked` counts the pushes still without an ack, `undelivered` the deliveries
  still missing. Each push, ack and delivery counts in the step of its push, however late.
- `degraded`: `yes` when ack p95 is over 1 s, fanout p95 over 2 s, errors, closes, `unacked` or
  `undelivered` are not zero, pushes were made and no ack came, or no fan-out sample came
  though other devices were due one.

A device has 30 s to open its socket, say hello and be welcomed, and 30 s more to get its
snapshot; one that fails is counted as an error and dropped. The arguments are checked: devices
positive integers that grow, members a positive integer, writers from 0 to 1, rate and hold
above 0, the port 1-65535; a violation names the flag.

The run exits 0, or 1 when the setup or a step failed; SIGINT and SIGTERM stop the devices and
the child gateway and exit 130. The load accounts live on the in-memory e2e stand and vanish
when it restarts: afterwards `mcproc restart surrealdb-e2e`, then `mcproc restart gateway-e2e`.
The seed sweep (`bun run seed:sweep`) targets the dev stand, not this one.
