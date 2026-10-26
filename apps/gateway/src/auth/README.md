# Accounts and device sessions (module `auth`)

## Role in the architecture

The gateway's accounts and device sessions: the routes that sign a device up, in and out,
the directory's `device_session` row of each identity's device, the identity access method's
tokens and refresh grants, and the Bearer caller every route with an access token shares. The
sync module binds a hello to the device's row and renews pairs through this module's
services. It has no domain rules of its own, so no `domain/` or `application/` folders, and
no `index.ts` yet: it predates the index rule and is imported file by file.

Its routes (`auth.routes.ts`) sign devices up and in (`POST /auth/sign-up`,
`POST /auth/sign-in` with `{ email, password, device: { id, label } }`, an email of at most
254 characters, taken in lower case, the device's own id of 1 to 64 characters and a label of
at most 60, answering
`{ identity, tokens, memberships }`, the memberships being the organisations the identity
belongs to), each call on a database session of its own that is
closed when the call ends. Every sign-up and sign-in records the
device in the directory's `device_session` (`DeviceSessions`, `device-sessions.ts`):
one row per identity and device with its label, the id of the refresh grant its pair holds now
(the second segment of the refresh key, `surreal-refresh-<grant>-<secret>`, read by
`grantIdOf`), when its current session started (`started_at`: the second the sign-in's access
token was issued in, read from the token's `iat` by `issuedAtOf`, `token-claims.ts`),
when it was seen last and whether it was signed out; a sign-in whose device cannot be recorded
fails and has the grant it minted revoked, and signing in again clears the mark, starts a new
session and forgets a pair parked for the device. A token carries only the second it was issued
in, so tokens of one second are not told apart: a token of the previous session issued in the
very second the device was signed out and signed in again binds to the new session until it
expires (at most 15 minutes). Using it takes a stolen token issued in the same wall-clock
second as both the sign-out and the new sign-in. A sign-in on a device whose row held another
grant revokes that grant (`REVOKE WHERE subject.record = … AND grant.id = …`, scoped to the
identity), so a device holds one live grant and a pair it left behind dies with the sign-in; a
revoke that fails is reported and leaves the sign-in standing. A sign-up or sign-in whose
memberships cannot be read answers 500 and is taken back: its device is marked signed out and its
grant revoked, since its pair never reached the device. Only a refusal by the database
is the caller's fault (401 `invalid-credentials`, 409 `sign-up-rejected`): a database that
cannot be reached answers 500, here, on every route and at every hello.

A Bearer call, on the device routes below and the organisation routes of `src/tenants`, acts
for the identity a device's access token signs in, sent as
`Authorization: Bearer <access>`, on the device it names in the `X-Perch-Device` header, which
every call with an access token must carry: a call without a valid device id answers 400
(`bad-request`), checked before any call to the database, and a device without a live session
row (unknown, or signed out: its access token still works, its calls do not), or whose session
started after the token was issued, 401 (`unauthorized`). A refresh key is not taken over HTTP:
a request with a valid device header but without an access token the database accepts answers
401, and one whose token the database could not judge answers 500; a missing or invalid
`X-Perch-Device` answers 400 first, before any token is checked. Every such 401 names the scheme
in `WWW-Authenticate: Bearer` (`bearer-caller.ts`).

The device routes (`device.routes.ts`) act for the identity of the Bearer access token
and its device the same way. `GET /devices` lists the
caller's devices, the earliest first, `{ devices: [{ id, label, createdAt, lastSeenAt,
revokedAt, current }] }` (times as ISO strings, `revokedAt` null for a device signed in,
`current` for the device named in the header; a device signed out from another one stays
listed for 30 days; neither the grant a device holds nor the device id its header names is
ever sent: a hello binds by that id, so a live access token must not learn the other devices'
ids). `DELETE /devices/:id` signs one
device of the caller out (204): its row is marked revoked, its refresh grant is revoked
(`ACCESS identity ON DATABASE REVOKE WHERE subject.record = … AND grant.id = …`, the grant id
going as a parameter: `REVOKE GRANT` takes none), a pair parked for it is forgotten and its
sockets are closed with 4001; an id that is not one of the caller's devices answers 404
(`no-such-device`). `POST /auth/sign-out-everywhere` signs every device of the caller out, the
asking one included (204): the identity's `sessions_revoked_at` is set to the start of the
current second, so every token issued in an earlier second is refused and a sign-in right after
the sign-out works (a token carries only the second it was issued in; one issued earlier in that
same second stays valid until it expires, but its grant is revoked and its row marked, so its
hello and its Bearer calls are refused all the same, unless its device signs in again in that
very second: the window named with `started_at` above), every refresh grant of the identity is
revoked, every device row is marked revoked, every parked pair is forgotten and every socket is
closed with 4001. A sign-out that
fails after its first write still closes what it signed out before it answers 500. `POST
/auth/sign-out` takes the pair in its body, `{ access, refresh }`, with `X-Perch-Device` and no
`Authorization`: the pair is the credential, so a device can revoke a pair it could not revoke
while offline even once its access token expired. The pair must sign an identity in (renewed
when its access token no longer works) and its refresh grant must be one of the identity's
devices: that row is marked signed out (a row marked already stays as it is), a pair parked for
it is forgotten, the device's sockets are closed with 4001, and the grant the pair holds (the
renewed one when renewed) is revoked through the database as the namespace user (`REVOKE WHERE
subject.record = … AND grant.id = …`, scoped to the identity), 204; a pair whose device was
signed out from another one already (its row marked, its grant revoked) answers 204 as well.
Every step may be asked again: a failure answers 500 and the device keeps the pair to try
again, and its retry marks the row and revokes the grant anew; a pair the database could not
judge answers 500 too, with nothing marked. A renewal spends the pair's refresh key, so a pair
the route renewed would be refused if asked again: the row's mark is tried three times (after
100, then 200 ms), and when it still fails the route closes the device the header names (its
parked pairs forgotten, its sockets closed with 4001), revokes the renewed grant and answers 500.
That row may then list the device as signed in until its next sign-in or a sign-out from My
devices; its grants are dead, so only a still valid access token of that session (at most 15
minutes old) could reach the gateway. A pair the database refused, or that no device of
the identity holds, answers 401 (`unauthorized`) and revokes nothing; a pair the route renewed
itself has its new grant revoked whatever it answers. A renewal the limits refuse answers 429
before the database is asked, with nothing revoked and the refresh key unspent (see `src/limits/README.md`). A
request without its device or its pair answers 400, before any key is checked; so does every
call with an access token that names no valid device.

Token scope: an access token issued for another namespace, database or access method is refused
before the database is asked (`data:AUTH_FAILED`, by `namesOtherScope` in
`token-claims.ts`), since the database would accept a record access token of another
database and switch the session to it. Its claims are read under every name SurrealDB 3.3 takes
them by: the `NS`, `DB` and `AC` it issues, `ns`, `db` and `ac`, and the namespaced
`https://surrealdb.com/ns` (or `/namespace`), `/db` (or `/database`) and `/ac` (or `/access`);
any of them that names another scope, or a scope named only in part, refuses the token. Such a
token is never renewed: a refresh key presented beside it is not spent. A payload without any of
these claims goes to the database as before.

## Surface

- Routes: `POST /auth/sign-up`, `POST /auth/sign-in` (`auth.routes.ts`); `GET /devices`,
  `DELETE /devices/:id`, `POST /auth/sign-out`, `POST /auth/sign-out-everywhere`
  (`device.routes.ts`).
- Services: `IdentitySessions` (`identity-sessions.ts`: sign-up, sign-in, the keys of a hello,
  renewals and revokes through the database), `DeviceSessions` (`device-sessions.ts`: the
  `device_session` rows), `PendingPairs` (`pending-pairs.ts`: parked pairs and the turns of a
  device's key operations), the Bearer caller (`bearer-caller.ts`, also used by the
  organisation routes), `accountEmail` (`account-email.ts`) and the token readers
  `issuedAtOf` and `namesOtherScope` (`token-claims.ts`).
- Queries: `surql/` (device rows, grant revokes, the identity's `sessions_revoked_at`).
- Built by the composition root, `src/composition/root.ts`.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`auth.routes.spec.ts`,
  `device.routes.spec.ts`, `device-sessions.spec.ts`, `identity-sessions.spec.ts`,
  `pending-pairs.spec.ts`, `token-claims.spec.ts`).
- `bun run test:db` (the smoke) drives sign-up, sign-in, renewals, device sessions and every
  sign-out against a stand.
