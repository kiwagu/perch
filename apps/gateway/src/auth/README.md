# Accounts and device sessions (module `auth`)

## Role in the architecture

The gateway's accounts and device sessions, on Better Auth with SurrealDB's own adapter for it
(`surrealAuthAdapter` from `@workspace/data/better-auth-adapter`, patched under `patches/`).
Better Auth runs inside the gateway, as its namespace user, over the one connection to the
directory that the composition root opens and the region hub uses too. Its four models live in
the directory's tables (`auth-models.ts`): a user is an `identity`, a session a
`device_session`, and `account` and `verification` keep their names, each camelCase field in its
snake_case column. Rows get ids of the workspace format with their table's prefix
(`generateAuthId`). The adapter writes a reference as a plain string, so the `identity` column
of `account` and `device_session` holds the identity's key, not a record id. A password is
hashed with argon2id under SurrealDB's own parameters (`password-hash.ts`), so a hash made on
either side verifies on the other; the hash lives on the identity's credential row of `account`.
The sync module reads a hello's session through this module's services, and the organisation
routes of `src/tenants` share its Bearer caller. It has no domain rules of its own, so no
`domain/` or `application/` folders, and no `index.ts` yet: it predates the index rule and is
imported file by file.

A session is a `device_session` row, and its token is the device's one credential: a random
value Better Auth mints at sign-up and sign-in, sent as `Authorization: Bearer <token>` on every
route and in the hello of the sync channel. Only the raw token, as the sign-in's body answers it
and the row holds it, names a session here. The signed form in Better Auth's `set-auth-token`
header (`<token>.<signature>`) is refused, since the gateway ends a session by its raw token. A
session lives 30 days from its sign-in (`SESSION_LIFETIME_MS`), except one signed in with
`rememberMe: false`, which Better Auth's sign-in accepts: it lives one day, until its device is
first seen, which slides it to 30 days like any other. Better Auth's own refresh is off: its
write of `expires_at` is unconditional and could bring an ended session back. The gateway
extends a live session itself, to a full lifetime from now, whenever its device is seen
(`DeviceSessions.seen`, at its hello and at most every five minutes it talks), with an update
that leaves an ended session as it is: it extends only a row without `ended_at`, so it cannot
bring a session back however late it lands, its retries included, though its instants were
taken before an ending committed. Better Auth reads the row at every read, with no cookie cache,
so a session that ended or expired reads as none at once.

Every session is bound to a device. A sign-up and a sign-in name it in `X-Perch-Device` (the
browser's own id, 1 to 64 characters) and `X-Perch-Device-Label` (at most 60 characters; any
other label is stored empty), which the session hooks (`session-hooks.ts`) write into the new
row. A request without a valid device is refused 400 `bad-request` when its session is about to
be created, so a sign-in with wrong credentials answers 401 before its device is looked at, and
a sign-up refused so leaves no account behind. Once the row exists, every session of the
identity on that device but the newest ends (the newest: created last, of the greater id among
those created at the same instant), the new row itself when a newer one exists already: a device
holds one live session, and its sign-ins converge on the newest whatever order their rows are
inserted and their hooks run in. Sessions of the identity on other devices, and of other
identities on a device of the same id, stay live.
Once Better Auth accepted a sign-up or a sign-in, or signed a device in at a verification, and
before its answer is returned, the mount closes the identity's sync sockets on that device with
1000: a socket opened with the session just ended goes no further, the device connects again with
the new token, and a hello with the earlier token whose session read was under way is refused 4001
at its registration. Every call
with a token must name the device its session was opened on, so a token carried to another
device is refused.

A session ends and is never deleted: its row's `expires_at` and `ended_at` become the moment it
ended, on the gateway's clock, and the row stays, so a device signed out from another one stays
listed with that moment. `ended_at` is set once and never moved or cleared, and empty only while
the session is live or has expired with nothing having ended it. Every ending is the gateway's
own update of `device_session` (`AuthSessions`: one session by its token, one session of an
identity by its id, or every session of an identity; the session hooks: all but the newest
session of a device at a sign-in), which leaves a session that ended already with its end and
marks one that expired ended at its expiry, so a late extension, prepared while it was live,
cannot bring it back once anything has ended it. Better Auth ends a session by deleting its row,
at its own sign-out and when it reads an expired one; the session hooks turn such a delete of one
row into the ending by its token and refuse the delete. The hooks run these endings on the
directory connection themselves: Better Auth's adapter writes only the fields of its own model,
so it would drop `ended_at`, which is the gateway's column. A delete
of several rows at once would stop at the first refusal, so Better Auth's bulk endings
(`/revoke-sessions`, `/revoke-other-sessions`) and `/change-password`, which ends the other
sessions that way, are switched off in the instance (`auth-instance.ts`). Rows whose session
ended 30 days ago or more are forgotten when the identity's devices are listed next.

Better Auth's handler is mounted behind an allowlist (`auth-handler/`). Of the paths under
`/auth/`, only `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/verify-email`
and `POST /auth/send-verification-email` reach it; every other path answers 404 `not-found`
without asking it, and another method on those four answers 405 with `Allow: POST`. The rest of Better Auth's endpoints stay out of reach: one lists an account's
sessions with every token, another ends a session without closing its device's sockets. Better
Auth serves its routes only under its public URL, `<GATEWAY_PUBLIC_URL>/backend/auth`, and trusts
requests from that origin only; the front strips its `/backend` prefix, so the mount puts it back
before it hands a request over. In front of Better Auth, the mount applies the gateway's own
limits (see `src/limits/README.md`): every sign-up, sign-in and verification takes one of its
client address's 20 credential checks in 10 s, a sign-in must find a place among its email's 10
failed sign-ins in 15 minutes (a 403, the password right and the email not verified, clears them
as a success does), and a resend takes one of its address's 200 verification mails and one of its
email's 3 resends in 15 minutes. A refusal answers 429 `rate-limited` with `Retry-After` before
any password is checked; Better Auth's own limiter is off. A sign-in whose body is not JSON naming
an email answers 400 `bad-request`; one that is reaches Better Auth as that very JSON, so the
email whose password is checked is the email counted. Better Auth's answers reach the client
without their `Set-Cookie` headers: the web signs in by bearer token alone. A refusal of Better
Auth's reaches the client as its status and its code alone, `{ code }`, and a failure (500 or
more) as `{ code: 'internal' }`: nothing of its message or the rest of its body, which can carry
what was sent or what failed.

A sign-up takes `{ name, email, password }` (a password of 8 to 128 characters) and, optionally,
`locale`, the language the person signs up in (`en` or `es`, any other answered 400; `en` when
it names none), which the identity keeps; a sign-in takes `{ email, password }`, both with the
device's headers. Each answers 200 with the raw session token (`token`) and the account (`user`,
its `id` the identity's). An email is kept and matched in lower case, so an address in any case
is one account. Wrong credentials answer 401 and a sign-up of an email that has an account 422,
with Better Auth's code alone in the body. A sign-up writes its identity, its credential row and its
session in one transaction.

The instance can verify an email, beside a sign-up that still signs its device in and sends nothing.
Better Auth signs the verification link's token with the auth secret (an HS256 token naming the
email) and hands it to `verificationMailer` (`verification-mail.ts`), its `sendVerificationEmail`,
which starts the mail and returns at once: the request that asked for a mail never waits for it. The
mail links to the front's own screen, `<GATEWAY_PUBLIC_URL>/verify-email?token=…`
(`verificationLink`, `VERIFY_EMAIL_PATH`), never to Better Auth's own verifying URL, and its token
lives a day (`VERIFICATION_LINK_LIFETIME_S`). It speaks the account's language: the one its settings
name once it has settings (`accountLocale`, `account-locale.ts`), the one it signed up in before.
Settings that could not be read, or name a language the gateway does not speak, send no mail and are
logged as `mail:LOCALE_UNREADABLE`, never a mail in a guessed language; a mail that could not be
written or sent is logged by its code (`mail:SEND_FAILED`, `mail:LINK_INVALID`), never with its
address or token, and so is an account that reads without a language (a row written before the
column had its default): no mail, `mail:SEND_FAILED`. The first verification of an account signs the
device that opened the link in, through the session hooks like a sign-in, so it names the device in
its headers; the link opened again verifies nothing and signs nothing in, and a link past its
lifetime is refused with `TOKEN_EXPIRED`. Better Auth's own resend answers alike for any email and
mails only an account not verified yet; a sign-in sends nothing.
`AuthSessions` reads what the mount needs for them: the session a verification signed in, by the
signed token of Better Auth's answer, with its account (`signedIn`), the identity of an email
(`identityOf`), and the email a link's token names, read with the secret (`verificationEmail`).

The mount serves both. A verification is `POST /auth/verify-email` with `{ token }` in its body
and the device's headers, so a link's token never sits in a URL the gateway serves. It runs in
this order. The device is named first (none answers 400 `bad-request`): Better Auth marks the
email verified before it creates the session, so a session refused for want of a device would
leave the email verified and nobody signed in. The token's email is read with the secret, and the
account's turn is taken (`GatewayRoot.accountTurns`, by the email in lower case): one account's
verifications run one at a time in this process, so Better Auth rereads the account's
`emailVerified` inside the turn, and of two exchanges at once, on one link or two, the second
answers `{ token: null }` and signs nothing in. A token the secret does not read (forged, or past
its lifetime) takes no turn: Better Auth refuses it. Inside the turn the identity of the email is
read (a failure answers 500 `internal` with nothing verified), then Better Auth's own
`GET /verify-email` is asked with the token alone (no `callbackURL`, so it never redirects) and
without the request's `Authorization` and `Cookie`, so no session of the request is taken for the
account's. When its answer carries a session, the identity's sockets on the device are closed
with 1000 at once, before the session is read back for the answer, so a readback that fails (500
`internal`) still leaves no socket of the device's earlier session open. It answers 200
`{ token, user: { id, email, name, locale } }` the first time (the raw token, the account's name
and the language it signed up in), 200 `{ token: null }` for an account verified before, and 401
`link-expired` for a link past its lifetime or `link-invalid` for any other that verifies
nothing, an unknown account's included. The turns are this process's: several gateway processes
would need a claim in the database.

A resend is `POST /auth/send-verification-email` with `{ email }`: Better Auth is handed the email
alone, without the request's `Authorization` and `Cookie`, so only its path for a visitor runs,
which answers alike, after the same floor of 500 ms, for an unverified, a verified and an unknown
email, and mails only the unverified one. The mount answers every resend it lets through 202 with
no body, the same headers whatever the email.

Nothing Better Auth reports reaches a log as it said it. Its logger and its error hook are the
gateway's (`auth-log.ts`): an error is logged as a code from a fixed table
(`auth:CREATE_USER_FAILED`, `auth:CREATE_SESSION_FAILED`, `auth:BACKGROUND_TASK_FAILED`, else
`auth:LIBRARY`) or by Better Auth's own code (`auth:<CODE>`, `auth:UNEXPECTED` when it names
none), with a fixed message; its words, its arguments and an error's cause are dropped, and its
warnings (a wrong password, an unknown email) are not logged. A failure that is not one of
Better Auth's answers, such as a query that failed, is answered by Better Auth 500 with no body,
which the mount passes on as `internal`: Better Auth's router would otherwise print it whole to
stderr, the query's bindings with it. SurrealDB's
adapter, which printed a failed join the same way, is patched to leave it to its caller.

The device routes (`device.routes.ts`) come before the mount in the server, so the two sign-outs
under `/auth/` are the gateway's own. They act for the identity whose live session the token
holds, on the device the request names (the Bearer caller, `bearer-caller.ts`):

- `GET /devices`: 200 `{ devices: [{ id, label, createdAt, lastSeenAt, revokedAt, current }] }`,
  the latest session of each of the caller's devices, the device signed in first coming first,
  those signed out within the last 30 days among them. `id` is the session row's id, `revokedAt`
  when the session ended (null while it is live), and `current` marks the device of the request.
  Neither a token nor a device's own id is ever sent: a hello binds by that id.
- `DELETE /devices/:id`: 204 once session `:id` of the caller has ended and its device's sockets
  are closed with 4001. A session that ended already answers 204 with nothing closed, so the
  device's later session keeps its sockets. An id that is not one of the caller's sessions
  answers 404 `no-such-device`.
- `POST /auth/sign-out-everywhere`: 204 once every live session of the caller has ended, the
  asking one included, and every socket of the identity is closed with 4001.
- `POST /auth/sign-out`: a device ends its own session with its token and its `X-Perch-Device`,
  and no body. The session is looked up by its token whatever its state, so a device can send a
  token it kept while offline. It answers 204 once the session has ended and, when it was live
  until then, the device's sockets are closed with 4001; 204 again for a session that ended
  already, or one that had expired (marked ended at its expiry, nothing closed: the device may
  hold a newer session since); and 401 `unauthorized` for a token no session holds or a session
  of another device. A failure answers 500 and the device keeps its token to ask again.

On these routes, a request that names no valid device answers 400 `bad-request` before any token
is read. One whose token holds no live session of that device answers 401 `unauthorized` with
`WWW-Authenticate: Bearer`, and a method the path does not take 405 with `Allow`. A failure of
the gateway, or a session the directory could not read, answers 500 `internal` and closes
nothing; the failure is logged by its code, without its cause. Nothing here logs a token, and no
error carries one.

## Surface

- Routes: `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/verify-email` and
  `POST /auth/send-verification-email`, Better Auth's behind the mount (`authHandler` and
  `AuthMountDeps`, `auth-handler/`: the mount, the sign-up, the sign-in, the verification and
  the resend, the close of a device's sockets, and the requests and refusals as Better Auth and
  the client get them), which one account's turns serialise (`GatewayRoot.accountTurns`, a
  `KeyedTurns` by the email in lower case); `GET /devices`, `DELETE /devices/:id`,
  `POST /auth/sign-out` and `POST /auth/sign-out-everywhere` (`deviceRoutes`,
  `device.routes.ts`).
- Headers: `Authorization: Bearer <token>`, `X-Perch-Device` (`DEVICE_HEADER`) and, at sign-up,
  sign-in and verification, `X-Perch-Device-Label` (`DEVICE_LABEL_HEADER`).
- Services: `createAuthInstance` and `authOptions` (`auth-instance.ts`: Better Auth's options,
  which the schema check reads too, `SESSION_LIFETIME_MS` and `VERIFICATION_LINK_LIFETIME_S`),
  `AUTH_MODELS` and `generateAuthId` (`auth-models.ts`), `hashPassword` and `verifyPassword`
  (`password-hash.ts`), `AuthLog`, `authLogger` and `authErrorReporter` (`auth-log.ts`),
  `verificationMailer`, `verificationLink` and `VERIFY_EMAIL_PATH` (`verification-mail.ts`),
  `accountLocale` (`account-locale.ts`), `sessionHooks` (`session-hooks.ts`), `AuthSessions`
  (`auth-sessions/`: `read` a session by its token,
  `signOut`, `revoke`, `revokeAll`, and for a verification `signedIn`, `identityOf` and
  `verificationEmail`; `SignedInAccount`), `DeviceSessions` (`device-sessions.ts`: `list`,
  `byToken`, `seen`) over the rows of `device-session-rows.ts`, the Bearer caller
  (`bearerCaller`, `bearerToken` and `bearerRefused` in `bearer-caller.ts`, also used by the
  organisation routes), `accountEmail` (`account-email.ts`, an email as the invitations take
  it) and `identityByEmail` (`identity-by-email.ts`: the one lookup of an identity by its email,
  in any case, answering its key and email or none; `AuthSessions.identityOf` and the
  organisations' invites use it, each deciding what none means).
- Queries: `surql/` (a row by its token, the rows of an identity's devices, the sweep of rows
  that ended 30 days ago, the mark of a device seen, the three endings of `AuthSessions`, the
  ending of all but a device's newest session at a sign-in, the language an account's settings
  name, and the identity of an email).
- Tables: `identity`, `account`, `device_session` and `verification` of the directory schema
  (`database/schema/directory/`), which `auth-schema.spec.ts` holds to Better Auth's own for
  these options.
- Built by the composition root, `src/composition/root.ts`.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs on an embedded in-memory directory
  (`auth-handler/mount.spec.ts` and `auth-handler/verification.spec.ts`, which also hold that
  nothing of an address, a token or a link reaches a log, stderr or an answer, a failed query's
  included, that one account's verifications at once sign one device in, and that a device's
  sockets close before a readback that fails, `auth-instance.spec.ts`, `auth-log.spec.ts`,
  `auth-models.spec.ts`, `auth-schema.spec.ts`, `auth-sessions/sessions.spec.ts`,
  `bearer-caller.spec.ts`, `device.routes.spec.ts`, `device-sessions.spec.ts`,
  `identity-by-email.spec.ts`, `password-hash.spec.ts`, `verification-mail.spec.ts`).
- `bun run test:db` (the smoke) checks the stand's mail server, then drives sign-up, sign-in,
  the credential limits, device sessions and every sign-out against a stand.
