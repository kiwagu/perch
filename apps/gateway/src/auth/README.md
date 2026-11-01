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
value Better Auth mints at a sign-in and at the first verification of an email, sent as `Authorization: Bearer <token>` on every
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

Every session is bound to a device. A sign-in and a verification name it in `X-Perch-Device`
(the browser's own id, 1 to 64 characters) and `X-Perch-Device-Label` (at most 60 characters;
any other label is stored empty), which the session hooks (`session-hooks.ts`) write into the
new row. A request without a valid device is refused 400 `bad-request` when its session is about
to be created, so a sign-in with wrong credentials answers 401 before its device is looked at; a
sign-up creates no session, and the mount names a verification's device before it asks Better
Auth (below). Once the row exists, every session of the
identity on that device but the newest ends (the newest: created last, of the greater id among
those created at the same instant), the new row itself when a newer one exists already: a device
holds one live session, and its sign-ins converge on the newest whatever order their rows are
inserted and their hooks run in. Sessions of the identity on other devices, and of other
identities on a device of the same id, stay live.
Once Better Auth accepted a sign-in, or signed a device in at the first verification of an
email, and before its answer is returned, the mount closes the identity's sync sockets on that
device with 1000 (a sign-up signs nothing in and closes nothing): a socket opened with the
session just ended goes no further, the device connects again with the new token, and a hello
with the earlier token whose session read was under way is refused 4001 at its registration.
Every call with a token must name the device its session was opened on, so a token carried to
another device is refused.

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
sessions that way when asked to, are switched off in the instance's HTTP handler
(`auth-instance.ts`); the gateway calls the change through `auth.api` without that and ends the
other sessions itself (`AuthSessions.revokeOthers`). Rows whose session ended 30 days ago or more
are forgotten when the identity's devices are listed next.

Better Auth's handler is mounted behind an allowlist (`auth-handler/`). Of the paths under
`/auth/`, only `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/verify-email`
and `POST /auth/send-verification-email` reach it, and the mount answers five more itself,
calling Better Auth on the server where it needs it: `POST /auth/request-password-reset`,
`POST /auth/reset-password`, `POST /auth/change-password`, `POST /auth/change-email` and
`POST /auth/confirm-email` (below). Every other path answers 404 `not-found` without asking
Better Auth, and another method on those nine answers 405 with `Allow: POST`. The rest of Better Auth's endpoints stay out of reach: one lists an account's
sessions with every token, another ends a session without closing its device's sockets. Better
Auth serves its routes only under its public URL, `<GATEWAY_PUBLIC_URL>/backend/auth`, and trusts
requests from that origin only; the front strips its `/backend` prefix, so the mount puts it back
before it hands a request over. In front of Better Auth, the mount applies the gateway's own
limits (see `src/limits/README.md`): every sign-up, sign-in and verification takes one of its
client address's 20 credential checks in 10 s, a sign-in must find a place among its email's 10
failed sign-ins in 15 minutes (a 403, the password right and the email not verified, clears them
as a success does), a sign-up takes one of its address's 200 verification mails in 15 minutes,
whatever its email, and a resend takes one of those and one of its email's 3 resends in 15
minutes. A refusal answers 429 `rate-limited` with `Retry-After` before
any password is checked; Better Auth's own limiter is off. A sign-in whose body is not JSON naming
an email answers 400 `bad-request`; one that is reaches Better Auth as that very JSON, so the
email whose password is checked is the email counted. Better Auth's answers reach the client
without their `Set-Cookie` headers: the web signs in by bearer token alone. A refusal of Better
Auth's reaches the client as its status and its code alone, `{ code }`, and a failure (500 or
more) as `{ code: 'internal' }`: nothing of its message or the rest of its body, which can carry
what was sent or what failed.

No account signs in before its email is verified (`requireEmailVerification`). A sign-up takes
`{ name, email, password }` and, optionally, `locale`, the
language the person signs up in (`en` or `es`, any other answered 400; `en` when it names none),
which the identity keeps. It signs nothing in: Better Auth writes the identity and its credential
row in one transaction and mails the account its verification link (`sendOnSignUp`), and for an
email that has an account it writes nothing, mails nothing, and answers with an account it made up,
whose fields differ from a real one's. So the mount answers every sign-up Better Auth accepted
(`auth-handler/sign-up.ts`) with its own `202` and no body, the same headers for a new, a taken
and a concurrently taken email, never sooner than `SIGN_UP_FLOOR_MS` (800 ms) after its request
began: the floor sits above the work of either branch (a new account's writes, a taken email's
hashing) and above Better Auth's own floor for a resend, so neither the answer nor its time tells
whether the email has an account. One email's sign-ups run one at a time (the account's turn,
`GatewayRoot.accountTurns`, by the email in lower case): two at once of a new email would
otherwise answer a success and a failure. The guarantee holds in one gateway process, and while a
sign-up's work stays under the floor. Before anything else, a sign-up takes one of its client
address's verification mails, whatever its email (429 when they are spent); a body that names no
email or no password answers 400 `bad-request`. The password must keep the rules of a new
password (`keepsPasswordRules` of `@workspace/kernel`: 10 to 35 characters, only Latin letters,
digits and the 32 printable ASCII symbols, with at least one digit, one uppercase letter, one
lowercase letter and one symbol); one that breaks them answers 400 `weak-password` at once,
before the email's turn, Better Auth and the directory, so the refusal reads nothing of the email.
Better Auth holds a new password to the same length (`minPasswordLength`, `maxPasswordLength`),
which it checks on a new password only: a sign-in checks no rule, so an account whose password was
set before the rules, of 8 to 128 characters, still signs in. Better Auth's refusals (a malformed
email, a language the gateway does not speak) pass as their status and code alone; they do not
depend on the email having an account. A sign-in takes `{ email, password }` with the device's headers and
answers 200 with the raw session token (`token`) and the account (`user`, its `id` the
identity's). An email is kept and matched in lower case, so an address in any case is one
account. Wrong credentials answer 401; the right password of an account not verified yet answers
403 `EMAIL_NOT_VERIFIED` and sends nothing (`sendOnSignIn: false`): the person asks for the mail
again.

Better Auth signs the verification link's token with the auth secret (an HS256 token naming the
email) and hands it to `verificationMailer` (`verification-mail.ts`), its `sendVerificationEmail`,
which starts the mail and returns at once: the request that asked for a mail never waits for it. The
mail links to the front's own screen, `<GATEWAY_PUBLIC_URL>/verify-email?token=…`
(`verificationLink`, `VERIFY_EMAIL_PATH`), never to Better Auth's own verifying URL, and its token
lives a day (`VERIFICATION_LINK_LIFETIME_S`). The mail is written by `@workspace/email`
(`renderVerificationMail`) and sent through the mail port. It speaks the account's language: the one its settings
name once it has settings (`accountLocale`, `account-locale.ts`), the one it signed up in before.
Settings that could not be read, or name a language the gateway does not speak, send no mail and are
logged as `mail:LOCALE_UNREADABLE`, never a mail in a guessed language; a mail that could not be
written or sent is logged by its code (`mail:SEND_FAILED`, `mail:LINK_INVALID`, or the email
package's `mail:LINK_LOST` and `mail:RENDER_FAILED`), never with its
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

A password is recovered through a reset link. `POST /auth/request-password-reset` `{ email }`
takes one of its client address's 200 mails in 15 minutes (the budget sign-ups and resends
share) and one of the email's 3 reset mails in 15 minutes, whatever the email (429 when either
is spent), then, in the account's turn by the email in lower case, asks Better Auth
(`AccountPasswords.requestReset`): for an email that has an account, it keeps a link in
`verification` (`reset-password:<token>`, the identity's key as its value, an hour of life,
`RESET_LINK_LIFETIME_S`) and calls `resetMailer` (`reset-mail.ts`), which ends the account's
earlier links first, so only the newest works, then starts the reset mail to the front's
`/reset-password?token=…` (`AccountMails.resetPassword`). Every request it took answers 202 with
no body, no sooner than `RESET_REQUEST_FLOOR_MS` (800 ms) after it began, alike for any email; one
whose email is not an email answers 400. `POST /auth/reset-password` `{ token, password }` takes
one of its address's 20 attempts in 10 minutes first, refused or not (429), then answers 400
`password-rejected` for a password that breaks the rules of a new password, the link kept; 401
`link-invalid` for a token no link holds (unknown, used, or replaced by a newer link), 401
`link-expired` for a link past its hour on the gateway's clock. Better Auth's own reset is not
used: it spends a link inside a transaction through a call SurrealDB's adapter lacks. In the
account's turn by its identity, the gateway spends the link itself (`ResetLinks.claim`, once
however many resets run at once; 401 `link-invalid` for the one that finds it gone) and sets the
password on the credential row, hashed as Better Auth hashes one (`AccountPasswords.set`). Then
every session of the account ends, the request's own session too when it is one of them, the
account's sockets close with 4002 (`CLOSE.passwordChanged`, `signed out because the password
changed`), every reset link and the pending change of its email end, and the notice of a changed
password starts (`afterPasswordChange`): 204 with no body, and nothing is signed in. Better Auth's
clean-up of expired rows is off (`verification.disableCleanup`), so a link past its hour reads as
expired, not unknown: an account keeps one reset link and one pending change of its email at
most, each replaced by the next.

A signed-in device changes its password with `POST /auth/change-password` `{ currentPassword,
password }`, its token and `X-Perch-Device` (400 `bad-request` without a valid device, 401
`unauthorized` for a token that holds no live session of it). It takes one of the address's
credential checks, answers 400 `password-rejected` for a new password that breaks the rules,
and must find a place among the account's 10 failed sign-ins in 15 minutes, as a sign-in does
(429 when they are spent): a wrong current password keeps its place there and answers 400
`invalid-credentials`, a right one clears them. In the account's turn, Better Auth checks the
current password and sets the new one (`AccountPasswords.change`, its `/change-password` through
`auth.api`, never with `revokeOtherSessions`); then every other session of the account ends and
the sockets of their devices close with 4002, the caller's own session and sockets staying, every
reset link and the pending change of its email end, and the notice starts: 204 with no body.

A signed-in device asks to change its email with `POST /auth/change-email` `{ email, password }`,
its token and `X-Perch-Device`. After a credential check of its address, a new email that is not
an email answers 400 `email-invalid`; then one of the address's mails and one of the account's 3
changes in 15 minutes are taken (429), and the password must find a place among the account's
failed sign-ins, a wrong one answering 400 `invalid-credentials` (`AccountPasswords.matches`,
Better Auth's `/verify-password` through `auth.api`). In the account's turn its earlier pending
change ends; when no account has the new email (the account's own counts as taken), a new change
is kept (`EmailChanges.ask`: one row per identity in `verification`, `change-email:<identity
key>`, a random `jti` as its value) and the mail to the new email starts, its link the front's
`/confirm-email?token=…` (`AccountMails.confirmEmail`). The token is a JWT naming the identity,
its email and the new one, the `jti` and when it was asked, signed with a key derived from the
auth secret (`account-links/change-token.ts`), so Better Auth's verification never takes it for
one of its own, nor the gateway one of Better Auth's for it. Both answer 202 with no body, no
sooner than `CHANGE_EMAIL_FLOOR_MS` (800 ms) after the request began, so neither the answer nor
its time tells whether the new email has an account; a taken email gets no mail. Better Auth's own
`/change-email` is switched off: it mails through the verification mail and signs the device that
confirms it in. `POST /auth/confirm-email` `{ token }`, with no session needed and none signed
in, takes one of its address's 20 attempts in 10 minutes first (429), then answers 401
`link-invalid` for a token the gateway did not sign as a confirmation, 401 `link-expired` for one
asked a day ago or more on the gateway's clock (`CONFIRMATION_LINK_LIFETIME_MS`). In the turn of
the account and then of the new email (so no sign-up of the new email runs meanwhile), the
pending change the token names is spent (`EmailChanges.claim`, once), and the account's email
becomes the new one only while it is still the email the change was asked from
(`EmailChanges.move`): 401 `link-invalid` when the change was not pending (used before, replaced
by a newer one, or ended by a change of the password), when the account's email changed since, or
when the new email has got an account meanwhile. Once it changed, the notice of a changed email
starts to the old email, written from the old email, the account's name and language alone
(`AccountMails.emailChanged`), and it answers 200 `{ identity, email }`, the account whose email
changed and its new email. Sessions stay: a session's caller reads the account's email afresh,
so every device's next call and hello sees the new one; the profile the devices show is
replicated, and the gateway does not write it.

The mails of a reset, a confirmation and the two notices (`account-mails.ts`, written by
`@workspace/email`) start at once and never hold the request, and speak the account's language,
as the verification mail does: its settings' once it has settings, its sign-up's before; settings
that could not be read send nothing (`mail:LOCALE_UNREADABLE`), and a mail that could not be read,
written or sent is logged by its code, never with its address, its name or its link. A notice of a
changed password links to the front's `/forgot-password`; the notice of a changed email carries
no link.

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
  `POST /auth/send-verification-email`, Better Auth's behind the mount, and
  `POST /auth/request-password-reset`, `POST /auth/reset-password`, `POST /auth/change-password`,
  `POST /auth/change-email` and `POST /auth/confirm-email`, the mount's own (`authHandler` and
  `AuthMountDeps`, `auth-handler/`: the mount, the sign-up and its floor, `SIGN_UP_FLOOR_MS`, the
  sign-in, the verification and the resend, the request for a reset mail and its floor
  `RESET_REQUEST_FLOOR_MS` and the reset (`password-reset.ts`), the change of a password
  (`password-change.ts`), the change of an email and its floor `CHANGE_EMAIL_FLOOR_MS` and its
  confirmation (`email-change.ts`), what follows a new password (`password-changed.ts`), the
  Bearer caller of the mount (`signed-in.ts`), the floors' wait (`floor.ts`), the close of a
  device's sockets, and the requests and refusals as Better Auth and the client get them),
  which one account's turns serialise (`GatewayRoot.accountTurns`, a `KeyedTurns` by the email in
  lower case or by the identity's key); `GET /devices`, `DELETE /devices/:id`,
  `POST /auth/sign-out` and `POST /auth/sign-out-everywhere` (`deviceRoutes`,
  `device.routes.ts`).
- Close code: 4002 (`CLOSE.passwordChanged`) on the sockets of a device whose session a reset or
  a change of the password ended, so the device can tell its person why it was signed out; 4001
  stays a sign-out from another device.
- Headers: `Authorization: Bearer <token>`, `X-Perch-Device` (`DEVICE_HEADER`) and, at sign-in
  and verification, `X-Perch-Device-Label` (`DEVICE_LABEL_HEADER`).
- Services: `createAuthInstance` and `authOptions` (`auth-instance.ts`: Better Auth's options,
  which the schema check reads too, `SESSION_LIFETIME_MS` and `VERIFICATION_LINK_LIFETIME_S`),
  `AUTH_MODELS` and `generateAuthId` (`auth-models.ts`), `hashPassword` and `verifyPassword`
  (`password-hash.ts`), `AuthLog`, `authLogger` and `authErrorReporter` (`auth-log.ts`),
  `verificationMailer`, `verificationLink` and `VERIFY_EMAIL_PATH` (`verification-mail.ts`),
  `resetMailer` and `RESET_LINK_LIFETIME_S` (`reset-mail.ts`), `AccountMails`,
  `RESET_PASSWORD_PATH`, `CONFIRM_EMAIL_PATH` and `FORGOT_PASSWORD_PATH` (`account-mails.ts`),
  `AccountPasswords` (`account-passwords.ts`: `requestReset`, `set`, `change`, `matches`),
  `ResetLinks` (`read`, `claim`, `endAll`, `keepNewest`) and `EmailChanges` (`ask`, `cancel`,
  `read`, `claim`, `move`; `CONFIRMATION_LINK_LIFETIME_MS`) (`account-links/`),
  `accountLocale` (`account-locale.ts`), `sessionHooks` (`session-hooks.ts`), `AuthSessions`
  (`auth-sessions/`: `read` a session by its token,
  `signOut`, `revoke`, `revokeAll`, `revokeOthers`, and for a verification `signedIn`,
  `identityOf` and `verificationEmail`; `SignedInAccount`), `DeviceSessions` (`device-sessions.ts`: `list`,
  `byToken`, `seen`) over the rows of `device-session-rows.ts`, the Bearer caller
  (`bearerCaller`, `bearerToken` and `bearerRefused` in `bearer-caller.ts`, also used by the
  organisation routes, and the caller's email and session row besides), `accountEmail` (`account-email.ts`, an email as the invitations take
  it) and `identityByEmail` (`identity-by-email.ts`: the one lookup of an identity by its email,
  in any case, answering its key and email or none; `AuthSessions.identityOf` and the
  organisations' invites use it, each deciding what none means).
- Queries: `surql/` (a row by its token, the rows of an identity's devices, the sweep of rows
  that ended 30 days ago, the mark of a device seen, the four endings of `AuthSessions`, the
  ending of all but a device's newest session at a sign-in, the language an account's settings
  name, the identity of an email, an identity's email, name and language for a mail, a reset
  link read, spent and ended, a pending change of the email kept, ended and spent, the move of
  an identity's email, and a password set on a credential row).
- Tables: `identity`, `account`, `device_session` and `verification` of the directory schema
  (`database/schema/directory/`), which `auth-schema.spec.ts` holds to Better Auth's own for
  these options.
- Built by the composition root, `src/composition/root.ts`.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs on an embedded in-memory directory
  (`auth-handler/mount.spec.ts` and `auth-handler/verification.spec.ts`, which also hold that
  nothing of an address, a token or a link reaches a log, stderr or an answer, a failed query's
  included, that one account's verifications at once sign one device in, that a device's
  sockets close before a readback that fails, and that every resend answers no sooner than
  Better Auth's floor; `auth-handler/sign-up.spec.ts`, which holds that a new, a taken and a
  concurrently taken email answer alike and no sooner than the floor, and that every sign-up
  takes one of its address's verification mails; `auth-handler/password-reset.spec.ts`,
  `auth-handler/password-change.spec.ts` and `auth-handler/email-change.spec.ts`, which hold the
  uniform answers and their floors, each limit, the single use, the newest link only, the
  expiry of a reset link and of a confirmation, the sessions ended with their sockets closed
  with 4002, every link ended after a reset, a change and a confirmation, the notices with their
  recipient and language, the old address's notice holding no part of the new email, and that
  nothing of an email, a token or a password reaches a log; `account-links/reset-links.spec.ts`,
  `account-links/email-changes.spec.ts`, `account-mails.spec.ts`, `account-passwords.spec.ts`,
  `reset-mail.spec.ts`, `auth-instance.spec.ts`, `auth-log.spec.ts`,
  `auth-models.spec.ts`, `auth-schema.spec.ts`, `auth-sessions/sessions.spec.ts`,
  `bearer-caller.spec.ts`, `device.routes.spec.ts`, `device-sessions.spec.ts`,
  `identity-by-email.spec.ts`, `password-hash.spec.ts`, `verification-mail.spec.ts`).
- `bun run test:db` (the smoke) checks the stand's mail server, then drives sign-up and the
  verification through the mail in the stand's mailbox, sign-in, the credential limits, the
  uniform sign-up and resend, the verification's refusals, the reset of a password through its
  mail (the uniform request, the link that signs a device out with 4002, the link spent), device
  sessions and every sign-out against a stand.
