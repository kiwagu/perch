# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. It listens on `127.0.0.1` at `GATEWAY_PORT`. Its HTTP
routes sign devices up and in (`POST /auth/sign-up`, `POST /auth/sign-in`, answering
`{ identity, tokens, memberships }`, the memberships being the organisations the identity
belongs to), each call on a database session of its own that is closed when the call ends;
`GET /health` answers `ok`. Devices sync over a WebSocket at `/sync`: a
device says hello with its keys at protocol 2 (the pair is renewed with the refresh key when
the access token no longer works, and the new pair is sent first), is welcomed with its
identity's private region, the region `tenant:<key>` of each organisation the identity belongs
to and those memberships, the only regions it may name, and subscribes, pulls, pushes, probes
and compacts there through the region hub, the server's copy of the replicated regions, which
answers it and sends each accepted batch to the region's other devices. The hub keeps a private
region in the directory and a tenant region in its organisation's database
(`src/tenants/region-databases.ts`), and checks each batch against the device's identity: a
note names its own member as its author, and nobody changes the author of a note. A
connection registers in the `ConnectionRegistry` (`src/sync/connections.ts`) once the keys are
accepted; when an identity's memberships change, each of its connections leaves the regions it
may no longer name at once, without waiting for the device's messages under way (one handled
from then on that names such a region closes the socket with 4403, and the hub sends it nothing
more there), and is sent a `memberships` message; it subscribes to a new organisation's region
itself. A change told while a connection's hello is under way applies right after its welcome.
Text the protocol refuses (4400, a hello of protocol 1
included), refused keys (4401), a region the device may not name (4403) and a hello that did
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
`src/tenants`, built by the composition root over the directory, serve them; on shutdown the
organisations' databases close after the region hub and before the directory. `TenantDatabases`
keeps one connection per organisation database in use, shared by every holder and closed once
nobody has held it for five minutes. `Organisations` creates an organisation (its directory
rows, its database, its creator as admin member there, then ready; a creation its creator left
unfinished is completed when the creator asks again), lists an identity's memberships in ready
organisations by key, lets an admin invite an existing identity by email and remove a member
other than itself, lists the members with their emails to any member, answers what it refuses
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
`Authorization: Bearer <access>`. A refresh key is not taken over HTTP: a request without an
access token that works answers 401 (`unauthorized`). `GET /organisations` lists the caller's
memberships; `POST /organisations` with `{ key, name }` creates an organisation with the caller
as its admin (201); `GET /organisations/:key/members` lists the members to a member;
`POST /organisations/:key/members` with `{ email }` lets an admin invite an identity; and
`DELETE /organisations/:key/members/:identity` lets an admin remove a member (204). A body or
an identity that does not follow its schema answers 400 (`bad-request`); a refusal answers its
code, with 400 for `invalid-key` and `invalid-name`, 403 for `not-a-member` and `not-admin`, 404
for `no-such-tenant` and `no-such-identity`, and 409 for `key-taken`, `already-member` and
`self`; a failure of the gateway answers 500 (`internal`).

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
  WebSocket endpoint; by default the e2e stand, `ws://127.0.0.1:8010/rpc`) as
  `GATEWAY_SURREAL_USER` with `GATEWAY_SURREAL_PASS` (by default the user the stand
  operator defines, `scripts/stand-operator.ts` at the repository root), signs up a new
  `@example.test` identity and drives two of its devices through sync and sign-out, then
  the organisation path (an organisation `smoke_<time>` created, a second identity invited,
  its device writing a note into the organisation's region that the owner's device receives, a
  note in the owner's name rejected as `foreign-owner`, the removal that closes the region with
  4403), one line per step.
- `bun run typecheck`, `bun run lint`.
