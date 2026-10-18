# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. It listens on `127.0.0.1` at `GATEWAY_PORT`. Its HTTP
routes sign devices up and in (`POST /auth/sign-up`, `POST /auth/sign-in` with
`{ email, password, device: { id, label } }`, the device's own id of 1 to 64 characters and a
label of at most 60, answering `{ identity, tokens, memberships }`, the memberships being the
organisations the identity belongs to), each call on a database session of its own that is
closed when the call ends; `GET /health` answers `ok`. Every sign-up and sign-in records the
device in the directory's `device_session` (`DeviceSessions`, `src/auth/device-sessions.ts`):
one row per identity and device with its label, the id of the refresh grant its pair holds now
(the second segment of the refresh key, `surreal-refresh-<grant>-<secret>`, read by
`grantIdOf`), when it was seen last and whether it was signed out; a sign-in whose device
cannot be recorded fails, and signing in again clears the mark. Devices sync over a WebSocket at
`/sync`: a device says hello with its keys and its device id at protocol 4 (the pair is renewed
with the refresh key when the access token no longer works, and the new pair is sent first).
The hello is bound to the device's row: a renewal moves the row from the grant it spent to the
new one, only while the row holds the spent grant and is not signed out; any other hello reads
the row. A device without a row, or whose row holds another grant, is closed with 4401 (`no
session for this device`), a device signed out with 4001, and a pair renewed for either is
revoked at once. A bound device is marked seen at its hello and then at most every five minutes
it talks, and is welcomed with its
identity's private region, the region `tenant:<key>` of each organisation the identity belongs
to and those memberships, the only regions it may name, and subscribes, pulls, pushes, probes
and compacts there through the region hub, the server's copy of the replicated regions, which
answers it and sends each accepted batch to the region's other devices. The hub keeps a private
region in the directory and a tenant region in its organisation's database
(`src/tenants/region-databases.ts`), and checks each batch against the device's identity: a
note names its own member as its author, and nobody changes the author of a note. Each
subscription carries the device's ability, built from its membership's role and the replica
schema (`defineAbilityFor`, the owner's everything in its private region): a member edits and
deletes only its own notes, an admin any, and the hub rejects any other write as
`forbidden-action`. The hub keeps the ability a subscription was made with, so a change of
role applies to a device's subscriptions from its next subscribe or hello.
A connection registers in the `ConnectionRegistry` (`src/sync/connections.ts`) once the keys are
accepted; when an identity's memberships change, each of its connections leaves the regions it
may no longer name at once, without waiting for the device's messages under way (one handled
from then on that names such a region closes the socket with 4403, and the hub sends it nothing
more there), and is sent a `memberships` message; it subscribes to a new organisation's region
itself. A change told while a connection's hello is under way applies right after its welcome.
Text the protocol refuses (4400, a hello of an older protocol
or one that names no device included), refused keys (4401), a region the device may not name
(4403) and a hello that did not come within 10 seconds (4408, after which the device connects
again) close the socket with the protocol's close codes; a device's sign-out leaves its regions,
revokes its refresh grant through the database's RPC and closes the socket with 4000, which
means the grant is revoked; a revoke that fails is tried once more, and a grant that still
cannot be revoked closes the socket with 1011 (`revoke failed`) instead; a sign-out also marks
the device's row. A device signed out from another device is closed with 4001 at once, whatever
it is doing, also while its hello is under way: the registry knows each connection's identity
and device (`ConnectionRegistry.close(identity, device, code)`, every device of the identity
when none is named), and each close moves a revocation epoch of the device or of the identity.
A hello reads the epoch once its keys are accepted, before it reads the row, and registers with
it: a sign-out that lands meanwhile refuses the registration (4001), one before it is seen by
the read. A connection that fails to close is reported and the others are closed all the same.
A renewed pair the socket closed before it could take is parked for 60 seconds under
the device and a SHA-256 digest of the refresh key the renewal spent (the key itself is not
kept) and logged at warn as `renewed pair not delivered: parked for the next hello of the
device`: the device's next hello with that spent key is refused the renewal, is handed the
parked pair once (`tokens`, before its welcome) and welcomed; a pair is never handed to another
device, and signing the device out forgets it. Keys, tokens and grant ids never reach its logs.

Organisations live in the same namespace, each in a strict database `t_<key>` of its own that
the gateway defines; the directory holds each organisation (`tenant`) and who belongs to it
(`membership`), and the organisation's database holds its `member` rows. Two services in
`src/tenants`, built by the composition root over the directory, serve them; on shutdown the
organisations' databases close after the region hub and before the directory. `TenantDatabases`
keeps one connection per organisation database in use, shared by every holder and closed once
nobody has held it for five minutes. `Organisations` creates an organisation (its directory
rows, its database, its creator as admin member there, then ready; a creation its creator left
unfinished is completed when the creator asks again), lists an identity's memberships in ready
organisations by key, lets an admin invite an existing identity by email and remove a member
other than itself, lists the members with their emails to an admin, answers what it refuses
with a refusal code (`invalid-key`, `key-taken`, `not-admin`, `already-member` and the like),
and tells its listeners an identity's new memberships whenever they change, answering once they
heard them: the composition root has the registry tell the identity's devices. A removal takes
the organisation's region from the removed identity's open connections as soon as the
directory's membership is gone, before the member row is deleted and before the memberships are
read again to be told, so a removal that fails after the directory (500) has revoked the region
all the same; asking again completes it. The changes of one identity's memberships (its
creations, the invites of it, its removals) run one after the other, each once the one before
it and its notification have settled, so the directory and the organisation's database end as
the last change left them and its devices hear the lists in that order. This holds within one
gateway process; gateways in several processes would need a durable revision of the memberships.

The organisation routes act for the identity a device's access token signs in, sent as
`Authorization: Bearer <access>`, on the device it names in the `X-Perch-Device` header, which
every call with an access token must carry: a call without a valid device id answers 400
(`bad-request`), checked before any call to the database, and a device without a live session
row (unknown, or signed out: its access
token still works, its calls do not) 401 (`unauthorized`). A refresh key is not taken over
HTTP: a request without an access token that works answers 401. `GET /organisations` lists the caller's
memberships; `POST /organisations` with `{ key, name }` creates an organisation with the caller
as its admin (201); `GET /organisations/:key/members` lists the members to an admin (403 `not-admin` to a member);
`POST /organisations/:key/members` with `{ email }` lets an admin invite an identity; and
`DELETE /organisations/:key/members/:identity` lets an admin remove a member (204). A body or
an identity that does not follow its schema answers 400 (`bad-request`); a refusal answers its
code, with 400 for `invalid-key` and `invalid-name`, 403 for `not-a-member` and `not-admin`, 404
for `no-such-tenant` and `no-such-identity`, and 409 for `key-taken`, `already-member` and
`self`; a failure of the gateway answers 500 (`internal`).

The device routes (`src/auth/device.routes.ts`) act for the identity of the Bearer access token
and its device the same way. `GET /devices` lists the
caller's devices, the earliest first, `{ devices: [{ id, device, label, createdAt, lastSeenAt,
revokedAt, current }] }` (times as ISO strings, `revokedAt` null for a device signed in,
`current` for the device named in the header; a device signed out from another one stays
listed for 30 days; the grant a device holds is never sent). `DELETE /devices/:id` signs one
device of the caller out (204): its row is marked revoked, its refresh grant is revoked
(`ACCESS identity ON DATABASE REVOKE WHERE subject.record = … AND grant.id = …`, the grant id
going as a parameter: `REVOKE GRANT` takes none), a pair parked for it is forgotten and its
sockets are closed with 4001; an id that is not one of the caller's devices answers 404
(`no-such-device`). `POST /auth/sign-out-everywhere` signs every device of the caller out, the
asking one included (204): the identity's `sessions_revoked_at` is set, so every token issued
before is refused, every refresh grant of the identity is revoked, every device row is marked
revoked, every parked pair is forgotten and every socket is closed with 4001. A sign-out that
fails after its first write still closes what it signed out before it answers 500. `POST
/auth/sign-out` takes the pair in its body, `{ access, refresh }`, with `X-Perch-Device` and no
`Authorization`: the pair is the credential, so a device can revoke a pair it could not revoke
while offline even once its access token expired. The pair must sign an identity in (renewed
when its access token no longer works) and its refresh grant must be one of the identity's
devices: that row is marked signed out (a row marked already stays as it is), a pair parked for
it is forgotten, the device's sockets are closed with 4001, and the grant the pair holds (the
renewed one when renewed) is revoked through the database as the namespace user (`REVOKE WHERE
subject.record = … AND grant.id = …`, scoped to the identity), 204. Every step may be asked
again: a failure answers 500 and the device keeps the pair to try again, and its retry marks
the row and revokes the grant anew. A pair that signs nobody in, or that no device of the
identity holds, answers 401 (`unauthorized`) and revokes nothing; a pair the route renewed
itself has its new grant revoked whatever it answers. A request without its device or its pair
answers 400, before any key is checked; so does every call with an access token that names no
valid device.

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
  one per organisation for the organisation services and routes.
- `bun run test:db`: the smoke test. It starts the gateway in its own process on a free
  port in front of the stand at `SURREAL_URL` (an `http(s)://` address becomes the
  WebSocket endpoint; `bun run test:db` at the repository root sets it through `mcproc exec`
  from the mcproc manifest: the e2e stand, `ws://127.0.0.1:8010/rpc` in the main checkout) as
  `GATEWAY_SURREAL_USER` with `GATEWAY_SURREAL_PASS` (by default the user the stand
  operator defines, `scripts/stand-operator.ts` at the repository root), signs up a new
  `@example.test` identity and drives two of its devices through sync and sign-out, then
  the organisation path (an organisation `smoke_<time>` created, a second identity invited,
  its device writing a note into the organisation's region that the owner's device receives,
  the owner editing that note as an admin, the invited device deleting its own note, its edit of
  the owner's note rejected as `forbidden-action`, the member list refused to it with 403, a
  note in the owner's name rejected as `foreign-owner`, the removal that closes the region with
  4403), on a further identity the clause of the access method: its fresh token accepted, the
  same token refused once `sessions_revoked_at` is set after it, a refresh not blocked by it, and
  the namespace user revoking the identity's grants (`ACCESS identity ON DATABASE REVOKE`) so
  that the refresh is refused; and on another identity its device sessions: a hello under a
  device with no session closed with 4401 and a call without `X-Perch-Device` answered 400, a
  laptop and a phone listed by `GET /devices` with the laptop as current, the phone signed out
  from the laptop (`DELETE /devices/:id`, its socket closed with 4001, its row revoked, its hello
  with its still working access token closed with 4001), a tablet signed in and
  then every device signed out from the laptop (`POST /auth/sign-out-everywhere`, the laptop's
  and the tablet's sockets closed with 4001), the laptop's old pair refused at hello (4401) and
  by `POST /auth/sign-out` (401); one line per step.
- `bun run load`: the load test, see below (`bun run load -- <arguments>` at the repository
  root gives it the e2e stand through `mcproc exec`).
- `bun run typecheck`, `bun run lint`.

## Load test

`bun run load -- [arguments]` at the repository root drives simulated devices against a
gateway of its own: it starts `src/index.ts` as a child process on port 5197, in front of the
e2e stand's SurrealDB (`SURREAL_URL` from `mcproc exec`), and waits for its `/health`. Each step
signs up the devices it adds (`load-<run>-<n>@example.test`), groups every `--members` of them
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
