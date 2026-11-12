# Gateway (`@workspace/gateway`)

## Role in the architecture

The server process in front of the central SurrealDB database (namespace `app`, database
`directory`), and that database's only client: it connects as its own namespace user
and applies the shared schema. It listens on `127.0.0.1` at `GATEWAY_PORT`. Its HTTP routes
sign accounts up and verify their emails, sign devices in and out, list and sign out an
identity's devices, serve organisations and their members, and invite emails to organisations by
a mailed link that the invited account accepts or declines, and serve the platform's operators its
accounts under `/console`; devices sync over a WebSocket at
`/sync`; `GET /health` answers `ok`.

The source is one module per mechanism of the platform under `src/`, each with its own README
for its role, surface and commands. `src/server.ts` routes each request to its module and
`src/composition/root.ts` builds them; `src/keyed-turns.ts` runs one key's work one turn at a
time (one identity's membership changes, one account's sign-ups, verifications, resets and
changes). The modules that predate the index rule have no
`index.ts` yet and are imported file by file.

- [auth](src/auth/README.md): accounts on Better Auth: sign-up, sign-in, the verification of an
  email and the resend of its mail behind the gateway's limits, the recovery and the change of a
  password and the change of an email with their mails, device sessions and their session tokens,
  the sign-outs and the Bearer caller.
- [sync](src/sync/README.md): a device's WebSocket from hello to close, and the registry of open
  connections.
- [tenants](src/tenants/README.md): organisations, their databases, memberships and members,
  their invitations and roles, and their routes.
- [console](src/console/README.md): the operators' console: the platform's accounts found a page at
  a time, one account's card, and what an operator does to an account: its name, its email, its
  ban and the lift of it, its sign-out everywhere, its reset and verification mails, and its
  removal, for operators alone.
- [limits](src/limits/README.md): the request limits and the 429 they answer.
- [mail](src/mail/README.md): the mail port and its SMTP adapter; the mails themselves are
  written by `@workspace/email`.

## Key exports

None: this is an application. Its entry point is `src/index.ts`, which registers the
`.surql` loader and runs `src/main.ts`; `SIGINT` and `SIGTERM` stop the server and close
the database. The environment it reads is `GATEWAY_PORT`, `SURREAL_URL` (the database's
WebSocket endpoint, `ws://` or `wss://`, such as `ws://127.0.0.1:8000/rpc`: the gateway keeps
one long-lived connection to the directory there), `GATEWAY_SURREAL_USER`,
`GATEWAY_SURREAL_PASS`, `GATEWAY_AUTH_SECRET`, `GATEWAY_PUBLIC_URL`, `GATEWAY_SMTP_URL` and
`GATEWAY_MAIL_FROM` (below), and optionally the logger's `LOG_LEVEL` and `LOG_FORMAT`; an invalid
variable stops the gateway with an issue that names it, never its value. `scripts/smoke/cli.ts`
is the entry point of the smoke test against a stand (the folder `scripts/smoke/`: the run, one
module per path of steps, the HTTP helpers the load test reuses).
`scripts/operator/cli.ts` is the host command that appoints operators
(`bun run operator -- grant <email>`, `revoke <email>`; [its README](scripts/operator/README.md)).

Auth secret and public origin: `GATEWAY_AUTH_SECRET` is the secret Better Auth signs and
encrypts with, required, with no default and at least 32 characters: generate one with
`openssl rand -hex 32`. `GATEWAY_PUBLIC_URL` is the front's public origin, such as
`https://localhost:5443` (a trailing slash is dropped): Better Auth serves its routes under
`<origin>/backend/auth` and trusts requests from that origin only.
The local stands use a literal of the mcproc manifest (`stand_auth_secret`) and their own
front's origin, for those stands only; the smoke and the load test, which run a gateway of their
own on the e2e stand, take the same two values from `mcproc exec`.

Mail server: `GATEWAY_SMTP_URL` is the SMTP server the gateway sends the account mails through,
`smtp://host:port` or `smtps://user:password@host:port` (such as a stand's MailDev,
`smtp://127.0.0.1:1025`), with no query string or fragment: the mail library would read them as
options of its own, over the gateway's waits and its silence. Its host is a domain name or an IP
address: the URL standard keeps the host of an `smtp://` address opaque, so a NUL byte written
`%00` passes it, but the mail library refuses such a host with an error that carries the whole
address, the password with it, so the configuration refuses it first, naming the variable.
`GATEWAY_MAIL_FROM` is the From of every mail, an address with or without a name
(`Perch <no-reply@example.test>`). Both are required, with no default: the gateway connects to the
server and greets it at start, and does not start when it does not answer within 10 s
(`mail:UNREACHABLE`), nor when the mail library still refuses its address (`mail:URL_INVALID`),
which it reports by that code alone, never with the address. `src/main.spec.ts` starts the process
with a `%00` host and finds the password nowhere in its output. The local stands send to their own
MailDev, the manifest's `stand_mail_from` as the From; the smoke and the load test take the e2e
stand's two values from `mcproc exec`, with `MAILBOX_URL`, the REST API of that stand's MailDev,
where they read the verification mail of every account they sign up: each verifies through the real
link, nothing writes `email_verified` for them.

Rotating the auth secret signs nobody out. A session is a bearer token stored in
`device_session`, which the secret does not sign: the gateway looks a session up by its raw
token, so every session open before a new secret stays live after it
(`src/composition/root.spec.ts` holds this). After a leak, a new secret is not enough: end the
sessions themselves. An account ends its own with "Sign out everywhere" on My devices
(`POST /auth/sign-out-everywhere`), which also closes its sockets. To end every session at once,
run `LET $now = time::now(); UPDATE device_session SET ended_at = ended_at ?? time::min([expires_at,
$now]), expires_at = time::min([expires_at, $now]) WHERE ended_at = NONE;` in the directory as the
gateway's namespace user (`ended_at` keeps a late mark of a device seen from extending a session
again, an expired one included), then restart the gateway, which closes the sockets opened before
the update; each device's next hello is then refused with 4401.

## Commands

- `bun run dev`: runs the gateway with `bun --watch`, restarted on a change of its sources. It
  reads its configuration from the environment, so run it through the root `bun run dev`, which
  gives it the development stand's settings (`scripts/stand-gateway/`, as the mcproc manifest's
  `gateway` app has them) after `mcproc start services`; the pm2 stand's `gateway` app
  (`mcproc start dev`) is the other way to run it.
- `bun run test`: unit and functional tests on embedded in-memory databases: the directory, and
  one per organisation for the organisation services and routes.
- `bun run test:db`: the smoke test. It starts the gateway in its own process on a free
  port in front of the stand at `SURREAL_URL` (an `http(s)://` address becomes the
  WebSocket endpoint; `bun run test:db` at the repository root sets it through `mcproc exec`
  from the mcproc manifest: the e2e stand, `ws://127.0.0.1:8010/rpc` in the main checkout) as
  `GATEWAY_SURREAL_USER` with `GATEWAY_SURREAL_PASS` (by default the user the stand
  operator defines, `scripts/stand-operator.ts` at the repository root) and with
  `GATEWAY_AUTH_SECRET`, `GATEWAY_PUBLIC_URL`, `GATEWAY_SMTP_URL` and `GATEWAY_MAIL_FROM`, those
  the stand's gateway runs with (required, no defaults; the root `bun run test:db` sets them from
  the manifest) and with `MAILBOX_URL`, the REST API of the stand's MailDev (required, an
  `http(s)://` address; the root `bun run test:db` sets it), checks that the stand's mail server
  answers, signs up a new `@example.test` identity and verifies it through the link of the mail
  it finds there, which signs its first device in (every identity the smoke signs up is verified
  so), and drives two of its devices through sync and sign-out (the signed-out device's token
  then refused at hello with 4401); then the credential steps, each from a device, so a
  simulated client address, of its own (21 sign-ins of unknown emails within 10 s, the 21st
  answered 429 with `Retry-After` by the gateway's limit per address; 11 wrong passwords for a
  further identity, the 11th answered 429 by its limit per email; a sign-up of a taken email
  answered 202 with no body and the same headers as a new one's, and mailed nothing; a sign-up
  whose password breaks the rules of a new password answered 400 `weak-password`; an
  unverified account's sign-in answered 403 `EMAIL_NOT_VERIFIED`; a resend answered 202 for an
  unverified, a verified and an unknown email, mailing the unverified one only; a fourth resend
  of one email within 15 minutes answered 429 with `Retry-After`; a verification with a made-up
  token answered 401 `link-invalid`, the right link opened again answered `{ token: null }`;
  and a verification naming no device answered 400, the email staying unverified, a sign-in
  refused 403, until a verification that names one); then the reset of a password on a fresh
  identity with a phone's socket open (a reset request answered 202 with no body for it and for
  an unknown email, mailing it only; the link of its mail opening `/reset-password`, setting a
  new password with 200 and `signedOut` false, as opened with no session, which closes the
  phone's socket with 4002 and closes its token's hello with 4002 too (why its session ended),
  refuses the old password, signs in with the new one and mails the notice of a changed
  password; the same link again answered 401 `link-invalid`); then on another identity its device
  sessions: a hello
  under a device with no session closed with 4401 and a call without `X-Perch-Device` answered
  400, a laptop and a phone listed by `GET /devices` with the laptop as current, the phone
  signed out from the laptop (`DELETE /devices/:id`, its socket closed with 4001, its row
  showing `revokedAt`, its token's hello closed with 4001) and signed in again (the old token's
  hello closed with 4001 all the same, a call with it answered 401, the new one welcomed), a tablet
  signed in twice (the first session ended by the second), then every device signed out from
  the laptop (`POST /auth/sign-out-everywhere`, every socket closed with 4001 and every token
  refused), a sign-in right after it answered 200 with a working token, the laptop's old token's
  hello closed with 4001, and a device signing itself out with `POST /auth/sign-out` (204 with
  its socket closed with 4001, 204 again, 401 for a made-up token); then, on the first
  identity, the organisation path (an organisation `smoke_<time>` created, a second identity
  invited by email and accepting the invitation by the id the invite answered, each device
  welcomed with its membership and role, the invited device writing a note
  into the organisation's region that the owner's device receives, the owner editing that note
  as an admin, the invited device deleting its own note, a late device of the owner subscribing
  to a snapshot that holds the admin's note and not the deleted one, the invited device's edit
  of the owner's note rejected as `forbidden-action`, a note in the owner's name rejected as
  `foreign-owner`, a note under the owner device's Loro peer rejected as `foreign-peer` with the
  owner's next note still acknowledged and delivered, the member list refused to it with 403,
  the removal that closes the region with 4403, and the removed identity's sign-out, after
  which its token is refused at hello with 4401); and last the console path (the first identity
  appointed an operator through the host command's `setPlatformRole`, a fresh identity with an
  open socket banned through `POST /console/accounts/:id/ban`, 204, its socket closed with 4004
  and the ban's reason, its token's hello closed with 4004 and its right password answered 403
  `account-banned`; the ban lifted, 204, and a sign-in working again; then every device of it
  signed out through `POST /console/accounts/:id/sign-out`, 204, the new session's socket closed
  with 4001); one line per step.
- `bun run load`: the load test, see below (`bun run load -- <arguments>` at the repository
  root gives it the e2e stand through `mcproc exec`).
- `bun run typecheck`, `bun run lint`.

## Load test

`bun run load -- [arguments]` at the repository root drives simulated devices against a
gateway of its own: it starts `src/index.ts` as a child process on port 5197, in front of the
e2e stand's SurrealDB (`SURREAL_URL` from `mcproc exec`), sending its mails to the e2e stand's
MailDev (`GATEWAY_SMTP_URL` and `GATEWAY_MAIL_FROM`, inherited from `mcproc exec`), and waits for
its `/health`; without `MAILBOX_URL`, that MailDev's REST API, it stops before it starts. Each
step signs up the devices it adds (`load-<run>-<n>@example.test`, each device from a simulated
client address of its own, as in the smoke, so no address spends its verification mails) and
verifies each through the link of its mail, as the smoke does, which signs the device in; it
groups every `--members` of them
into an organisation `load_<run>_<k>` (the first creates it and invites the rest by email, each
accepting by the id its invite answered), opens their
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
