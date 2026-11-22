# Accounts and device sessions (module `auth`)

## Role in the architecture

The gateway's accounts and device sessions, on Better Auth with SurrealDB's own adapter for it
(`surrealAuthAdapter` from `@workspace/data/better-auth-adapter`, patched under `patches/`).
Better Auth runs inside the gateway, as its namespace user, over the one connection to the
directory that the composition root opens and the region hub uses too. Its four models, and the
models of its two-factor and passkey plugins, live in the directory's tables (`auth-models.ts`): a
user is an `identity`, a session a `device_session`, a second factor a `two_factor`, and
`account`, `verification` and `passkey` keep their names, each camelCase field in its snake_case
column. Rows get ids of the workspace format with their table's prefix
(`generateAuthId`). The adapter writes a reference as a plain string, so the `identity` column
of `account`, `device_session`, `two_factor` and `passkey` holds the identity's key, not a
record id. A password is
hashed with argon2id under SurrealDB's own parameters (`password-hash.ts`), so a hash made on
either side verifies on the other; the hash lives on the identity's credential row of `account`.
The sync module reads a hello's session through this module's services, and the organisation
routes of `src/tenants` share its Bearer caller. It has no domain rules of its own, so no
`domain/` or `application/` folders, and no `index.ts` yet: it predates the index rule and is
imported file by file.

Better Auth runs with its admin plugin as a hybrid (`adminPlugin`, `admin-plugin.ts`): the
gateway takes its fields, its refusal of a banned account's session and its role on the session
read, and none of its endpoints. An account keeps one platform role and a ban in the plugin's
fields, stored in the directory's columns: `role` (`user`, which the plugin writes when Better Auth
creates an account, or `operator`; the directory refuses any other), `banned` (false until a ban),
`ban_reason` and `ban_expires` (which the gateway never sets) on `identity`, and `impersonated_by`
on `device_session`, which stays empty. Only `operator` is a platform role (`PLATFORM_ROLES` of
`@workspace/kernel`): `rolesOf` (`platform-roles.ts`) is the one mapping of the stored role to
the account's platform roles, `user`, an empty role and any other value being none. The caller
read (`AuthSessions.read`) gives every caller those roles (`SessionCaller.roles`, and the Bearer
caller's `roles`), mapped from the role Better Auth's session answer carries, at every read and
never kept: a role granted or taken back counts from the next call and the next hello, whose
welcome carries them to the device (`sync/README.md`). The plugin's
hook refuses a new session to a banned account with 403 `BANNED_USER`, after the password and
the email's verification were checked, and before the gateway's own session hook: Better Auth
runs a plugin's database hooks before the application's. The mount forwards that refusal as 403
`account-banned` (`refusalOf`, the one place Better Auth's code is renamed), and a ban that commits
after the plugin read the account unbanned is seen by the session's admission, which reads the
ban in its own transaction (below). Every path of the plugin's endpoints
(`ADMIN_PATHS`, `admin-paths.ts`, read from the configured plugin's own table, so one a later
version adds is among them) is switched off in the instance's HTTP handler (`disabledPaths`), and
the mount serves none of them (404 `not-found`), so no request sets a role, bans, lists or
impersonates an account through the plugin; the gateway never calls them on the server either.
Neither of the plugin's roles is granted any of its permissions, which would guard only those
endpoints.

Better Auth also runs its two-factor plugin and its passkey plugin (`@better-auth/passkey`,
`passkeyPlugin` in `passkey-plugin.ts`), each keeping its rows in the directory: an account's
second factor in `two_factor` (the key's secret and its backup codes, encrypted, and whether a
code of the key confirmed it) with the flag `two_factor_enabled` on `identity`, and its passkeys
in `passkey`. The two-factor plugin's own lockout is off (`accountLockout`): a sign-in's wrong
codes are the email's failed sign-ins, as its wrong passwords are. A passkey is bound to the
front's host and origin, is a discoverable credential and asks for its user's verification at
its registration; the plugin's hooks refuse a registration or a sign-in whose authenticator did
not verify its user (`USER_NOT_VERIFIED`), before a passkey is kept or a session written. The
plugin turns any failure inside a ceremony that is not Better Auth's own error into a refusal of
what the device sent, a database that failed among them, so the adapter Better Auth runs on tells
a failed write of a passkey (kept, or its count of signatures moved on) or of a session apart
(`storageFailuresTold`, `storage-failures.ts`): it is thrown as Better Auth's own 500
`STORAGE_FAILED`, nothing of its cause kept, and logged as `auth:STORAGE_FAILED`, so the gateway
answers it 500 `internal`, a malformed or mismatched answer staying 400 `failed`.
Sessions have no freshness limit (`session.freshAge: 0`), so a device signed in for months may
add a passkey. Neither the mount nor the passkey routes hand any of the plugins' endpoints over
HTTP: they reach them through the gateway's own calls (`internalRequest`, `auth-handler/challenge-cookie.ts`): a request to Better
Auth's path behind the front, from the front's origin, with the device's headers, the plugin's
challenge as its only cookie, in the wire form Better Auth set it (`setCookieValue` reads it from
Better Auth's `set-cookie`, never decoded and encoded again, nor trimmed: a value padded with
whitespace reads as none), a bearer only for a call made while
signed in, and `X-Perch-Admission: pending` when the call writes a session. A challenge is one
cookie value on the wire (`challengeValue`: no separator, whitespace, quote or backslash), which a
route parses from what a device sends; a call whose challenge is not one is refused with an error
and never built, so no value can add a second cookie, a session's among them.

A session is a `device_session` row, and its token is the device's one credential: a random
value Better Auth mints at a sign-in and at the first verification of an email, handed to the
device only once the gateway admitted its session (below), and sent as `Authorization: Bearer <token>` on every
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
Auth (below). A sign-in's row and a verification's are written waiting for the gateway's
admission (`pending`), and no caller reads a waiting row as a session (below). When a sign-in's
row is admitted against the account's limit of devices, and when a verification's row is
admitted (below), in the admission's transaction, every admitted session of the identity on that
device but the newest ends (the newest: created last, of the greater id among those created at
the same instant), the new row itself when a newer one exists already; the session hooks do the
same once a row admitted as it is written exists (a sign-in Better Auth's own API wrote, without
the gateway's sign-in route): a device holds one live session, and its sessions converge on the
newest whatever order their rows are inserted and their statements run in. A row that waits for
its admission is neither kept nor ended, so the device's earlier session stays live until the
sign-in or the verification is admitted, and as it was when it is not (a sign-in asked about the
limit, one or a verification that does not stand, an account banned). Sessions of the identity on other devices, and of other
identities on a device of the same id, stay live.
Once the gateway admitted a sign-in Better Auth accepted, or the session the first verification
of an email signed in (below), and before its answer is returned, the mount closes the identity's
sync sockets on that device with 1000 (a sign-up signs nothing in and closes nothing, and neither
does a sign-in asked about the limit of devices, a sign-in or a verification that does not stand,
or one refused for a ban): a socket opened with the session just ended goes no further, the device connects again
with the new token, and a hello
with the earlier token whose session read was under way is refused 4001 at its registration.
Every call with a token must name the device its session was opened on, so a token carried to
another device is refused.

A session ends and is never deleted once its device holds it (the one row deleted is the new
session of a sign-in asked about the account's limit of devices, which no device ever held): its
row's `expires_at` and `ended_at` become the moment it
ended, on the gateway's clock, and the row stays, so a device signed out from another one stays
listed with that moment. `ended_at` is set once and never moved or cleared, and empty only while
the session is live or has expired with nothing having ended it. An ending that finds the session
live and comes from elsewhere also sets `ended_reason`, in the same update and as fixed: `revoked`
(signed out from another device, or every device at once), `password-changed` (the account's
password changed, on another device or through a reset link), `device-limit` (a sign-in past
the account's limit of devices) or `banned` (an operator banned the account, which gives it to
every session the ban ends, an expired one too; an admission that finds the account banned ends
its waiting session so too); the device's own sign-out, a new sign-in of the same device and
an expiry leave it empty. A hello whose token reads no live session is closed with the code of
that reason, so a device offline when its session ended still learns why while the row is kept
(`sync/README.md`). Every ending is the gateway's
own update of `device_session` (`AuthSessions`: one session by its token, one session of an
identity by its id, or every session of an identity; all but the newest session of a device, by
the admissions of a sign-in and of a verification, and by the session hooks for a row written
admitted; a waiting session of a banned account, by its admission), which leaves a session
that ended already with its end and marks one that expired ended at its expiry, so a late
extension, prepared while it was live,
cannot bring it back once anything has ended it. Better Auth ends a session by deleting its row,
at its own sign-out and when it reads an expired one; the session hooks turn such a delete of one
row into the ending by its token and refuse the delete. The hooks run these endings on the
directory connection themselves: Better Auth's adapter writes only the fields of its own model,
so it would drop `ended_at`, which is the gateway's column. A delete
of several rows at once would stop at the first refusal, so Better Auth's bulk endings
(`/revoke-sessions`, `/revoke-other-sessions`) and `/change-password`, which ends the other
sessions that way when asked to, are switched off in the instance's HTTP handler
(`auth-instance.ts`), as is every endpoint of the admin plugin (above); the gateway changes a
password itself, ending the other sessions in the same transaction (below). Rows whose session ended 30 days ago or more are forgotten when the
identity's devices are listed next.

Better Auth's handler is mounted behind an allowlist (`auth-handler/`). Of the paths under
`/auth/`, only `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/verify-email`
and `POST /auth/send-verification-email` reach it, and the mount answers seven more itself,
calling Better Auth on the server where it needs it: `POST /auth/request-password-reset`,
`POST /auth/reset-password`, `POST /auth/change-password`, `POST /auth/change-email`,
`POST /auth/confirm-email`, `POST /auth/request-account-deletion` and
`POST /auth/delete-account` (below). Every other path answers 404 `not-found` without asking
Better Auth, and another method on those eleven answers 405 with `Allow: POST`. The rest of Better Auth's endpoints stay out of reach: one lists an account's
sessions with every token, another ends a session without closing its device's sockets. Better
Auth serves its routes only under its public URL, `<GATEWAY_PUBLIC_URL>/backend/auth`, and trusts
requests from that origin only; the front strips its `/backend` prefix, so the mount puts it back
before it hands a request over. In front of Better Auth, the mount applies the gateway's own
limits (see `src/limits/README.md`): every sign-up, sign-in and verification takes one of its
client address's 20 credential checks in 10 s, a sign-in must find a place among its email's 10
failed sign-ins in 15 minutes (a 403 `EMAIL_NOT_VERIFIED` or `account-banned`, the password right,
clears them as a success does; any other 403, Better Auth's refusal of the request's origin, its
Fetch Metadata or its callback, comes before the password is checked and counts nothing), a
sign-up takes one of its address's 200 verification mails in 15 minutes, whatever its email, and a
resend takes one of those and one of its email's 3 resends in 15 minutes. A refusal answers 429
`rate-limited` with `Retry-After` before any password is checked; Better Auth's own limiter is off.
A sign-in whose body is not JSON naming an email of at most the `email` value's length and a
password, as strings, answers 400
`bad-request` before anything is read for the email, alike for any email. One that is reaches
Better Auth as that very JSON, so the email whose password is checked is the email counted, but
for a password of a length no account's password has (outside the `password` value's, the empty
one included): Better Auth gets `NO_ACCOUNTS_PASSWORD` in its place (`password-length.ts`), ten
spaces, which no password set under the rules has and which the password verifier
(`verifyPassword`, `password-hash.ts`) never accepts, so it is refused, counted and timed as a
wrong one, after the same checks of the request (its origin, the email's shape) as any other
(Better Auth would fail to hash an empty password, which it hashes to time an unknown email's
answer). Better Auth's answers reach the client
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
email, no password or no name, or an email longer than the `email` value allows (as every
body's email is held to), answers 400 `bad-request`. The password must keep the rules of a new
password (`keepsPasswordRules` of `@workspace/kernel`: the length of the `new-password` value, only
Latin letters, digits and the 32 printable ASCII symbols, with at least one digit, one uppercase
letter, one lowercase letter and one symbol); one that breaks them answers 400 `weak-password` at
once, before the email's turn, Better Auth and the directory, so the refusal reads nothing of the
email. The name must keep the rule of a profile's name (`profileNameOf`: 1 to the `profile.name`
field's length in characters once trimmed); one that breaks it answers 400 `name-required` or
`name-too-long` at once, on the same terms, whatever the email.
Better Auth holds a new password to the same length (`minPasswordLength`, `maxPasswordLength`),
which it checks on a new password only: a sign-in checks no rule, and a password of another
length is no account's, so it is refused as a wrong one. Better Auth's refusals (a malformed
email, a language the gateway does not speak) pass as their status and code alone; they do not
depend on the email having an account. A sign-in takes `{ email, password }` with the device's headers and
answers 200 with the raw session token (`token`) and the account (`user`: its `id`, the
identity's, its `email`, its `name` and `emailVerified`). The answer is built by that allowlist
from Better Auth's, parsed (`auth-handler/sign-in.ts`), never forwarded: nothing else of it
reaches the device, neither the account's role nor its ban (`role`, `banned`, `banReason`,
`banExpires`) nor any field a later version of Better Auth or a plugin adds, and an answer that
names less is answered 500 `internal`. While the account has not started, the answer also carries `start`:
`{ "start": { "name": "<the name it signed up with>", "locale": "en" | "es" } }`, the language it
signed up in. The account has not started while its profile or its settings have not reached the
directory: the region hub projects the rows of the identity's private region there, so a row a
device created and pushed is found by the identity. The device that gets `start` creates the
settings (`locale`, and the `theme` that device shows) and the profile (`name`, the account's email) under ids derived from the
identity, as the device that verifies the email by the sign-up mail's link does with the answer of
that verification; several devices that sign in before either row arrives all get it, and their
creations converge on the same records. This is how an account whose email a reset verified (it
never opened its sign-up link) gets its settings and profile at its first sign-in, and also how a
device signing in before the verifying device's start reached the server learns of it. An email is
kept and matched in lower case, so an address in any case is one account. Wrong credentials answer 401; the right password of an account not verified yet answers
403 `EMAIL_NOT_VERIFIED` and sends nothing (`sendOnSignIn: false`): the person asks for the mail
again.

Better Auth signs its verification token with the auth secret (an HS256 token naming the email
alone) and hands it, with the account, to `verificationMailer` (`verification-mail.ts`), its
`sendVerificationEmail`, which starts the mail and returns at once: the request that asked for a
mail never waits for it. The mail links to the front's own screen,
`<GATEWAY_PUBLIC_URL>/verify-email?token=…` (`verificationLink`, `VERIFY_EMAIL_PATH`), never to
Better Auth's own verifying URL. The link's token is the gateway's own
(`account-links/verification-token.ts`): it names the account the mail goes to beside Better
Auth's token, signed with a key derived from the auth secret (`verificationKey`), so Better Auth
never takes it for one of its own, nor the gateway one of Better Auth's, or a confirmation's, for
it. Better Auth's token alone cannot tell one account of an email from another: once a
confirmation freed an email and a new sign-up took it, it would verify, and sign in, the new
account. Better Auth's token inside lives a day (`VERIFICATION_LINK_LIFETIME_S`), and so does the
link. The mail is written by `@workspace/email`
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
(`identityOf`), and what a link's token names, read with the derived key (`verificationOf`): the
account its mail went to, Better Auth's token, and the email that token names, read with the
secret (none once it is past its lifetime).

The mount serves both. A verification is `POST /auth/verify-email` with `{ token }` in its body
and the device's headers, so a link's token never sits in a URL the gateway serves. It runs in
this order. The device is named first (none answers 400 `bad-request`): Better Auth marks the
email verified before it creates the session, so a session refused for want of a device would
leave the email verified and nobody signed in. The link's token is read with the derived key: one
the gateway did not sign as a link's (made up, or Better Auth's own token bare) answers 401
`link-invalid`, and one whose Better Auth token no longer reads answers 401 `link-expired` (the
gateway signed it while that token was fresh, so its day has passed), both before any turn and
without asking Better Auth. Then the account's turn is taken (`GatewayRoot.accountTurns`, by the
email Better Auth's token names, in lower case): one account's verifications run one at a time in
this process, so Better Auth rereads the account's `emailVerified` inside the turn, and of two
exchanges at once, on one link or two, the second answers `{ token: null }` and signs nothing in;
and no sign-up or confirmation gives the email to another account meanwhile. Inside the turn the
account that holds the email is read with the hash of its password, as a sign-in reads them
(`AccountPasswords.credentialOf`; a failure answers 500 `internal` with nothing verified), and a
link verifies only the account its mail went to: when another account holds the email, or
none does, it answers 401 `link-invalid`, verifying and signing in nothing, Better Auth not asked.
Otherwise Better Auth's own `GET /verify-email` is asked with its token alone (no `callbackURL`,
so it never redirects) and without the request's `Authorization` and `Cookie`, so no session of
the request is taken for the account's. Better Auth's refusal reaches the client as its status and
code alone, its own gate's refusal of an account banned before the session was written as 403
`account-banned` (the email is verified all the same: Better Auth marks it before it creates the
session); its failure, a 5xx its router answered or a promise that rejected (a failure it rethrows
outside its router), answers 403 `account-banned` when the email's account, read again, is the
link's and banned, else 500 `internal`, never with a token. When its answer carries a session,
that session waits for the gateway's admission (`pending`, written so on Better Auth's
`/verify-email` whatever the request names), and is read back by the signed token of Better
Auth's answer (`AuthSessions.signedIn`, through Better Auth's own read, which takes a waiting
session and gives its raw token: the one read of a waiting session but the admissions'). The
session is then held to the account as a sign-in's is (`signInStands`): the email's account
and its hash are read again, and the session stands only when both reads found the account the
link was mailed to, with the same password, and Better Auth signed that account in. A session
that stands is admitted (`AuthSessions.admitVerified`, `surql/device-sessions-admit-verified.surql`,
in the account's turn of admissions beside its sign-ins'), one transaction that finds the session
by its token whatever its ending and reads the account's ban: a banned account answers 403
`account-banned`, no token, the session ended `banned` unless the ban ended it already; a live
session waits no more, the device's earlier sessions end as at a sign-in (no limit of devices is
judged), and only then are the identity's sockets on the device closed with 1000 and the token
handed out; a session a reset ended meanwhile answers as one that no longer reads (below). An
admission that fails answers 500 `internal` and ends the session by its token; should that ending
fail too, the session keeps waiting, never handed out. A readback that fails answers 500
`internal`, the device's earlier session and its sockets left as they were. So whichever of a ban
and the admission commits second sees the other: a ban before it ends the waiting session or is
read by it, a ban after it ends the admitted session with every other. A
verification holds the email's turn and a reset the account's, so a reset can run beside it, and
one that commits while Better Auth verifies the email ends every session it finds before the
verification's is written: then the password changed, so the session is ended at once by its token
and the answer carries none, `{ token: null }` (the reset verified the email) or, when the email left
the account meanwhile, 401 `link-invalid`. A reset that commits after the second read ends the
session itself. A session that no longer reads back, or that the admission finds ended, has
nothing left to end and is answered by the second read: 403 `account-banned` when the link's
account is banned (the ban ended it), else as above. So no session a verification wrote outlives a reset that completed meanwhile. It
answers 200 `{ token, user: { id, email, name, locale } }` the first time (the raw token, the
account's name and the language it signed up in), 200 `{ token: null }` for an account verified
before, by an earlier opening or by a reset (Better Auth signs nothing in for a verified account),
and 401 `link-expired` for a link past its lifetime or `link-invalid` for any other that verifies
nothing, an unknown account's and another account's included. The turns are this process's:
several gateway processes would need a claim in the database.

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
used: it spends a link inside a transaction through a call SurrealDB's adapter lacks, and sets the
password apart from the endings that must go with it. The new password is hashed, as Better Auth
hashes one, before the account's turn by its identity; in the turn, one transaction of the
directory (`AccountPasswords.reset`, `surql/password-reset-commit.surql`) judges the link again
on the clock as it is then, so a link spent, replaced or expired while the reset waited answers
401 `link-invalid` or `link-expired` with nothing changed, and otherwise spends it with every
other reset link of the account, sets the password on the credential row, ends every session of
the account (the request's own session too when it is one of them), verifies its email when it was
not yet (only that mailbox got the link; Better Auth's `emailVerified` is what a sign-in reads, so
the account signs in from then on, its first sign-in carrying `start`), deletes its pending
change of email and ends its pending two-factor challenges: all of them or none, so a failure (500 `internal`) leaves the password, the link, the
sessions and the pending change as they were. Once it committed, the account's sockets close with
4002 (`CLOSE.passwordChanged`, `signed out because the password changed`) and the notice of a
changed password starts (`afterPasswordChange`): 200 `{ signedOut }`, and nothing is signed in.
`signedOut` is true when the session the request carries (its token and `X-Perch-Device`, read as
the device routes read them, in the turn and before the reset ends it) was the account's, and
false for another account's, a dead one or none, so a device signed in to the account signs out
even with no channel to hear the 4002; a session that could not be read answers 500 `internal`,
nothing changed.
A sign-in takes no turn of the account, so it runs alike, and as soon, whether its email has an
account and whatever work of that account is under way (`auth-handler/sign-in.ts`). It reads the
email's account and the hash of its password before Better Auth checks the password
(`AccountPasswords.credentialOf`, the same read for an email that has no account) and again once
Better Auth wrote the session, and the sign-in stands only when both reads found the very account
Better Auth signed in (its answer's `user.id`), with a password, the same one
(`signInStands`). Otherwise (a reset or a change gave the account a new password, or
confirmations moved the email between accounts, however often and back again, while Better Auth
looked it up or checked the password) the session is ended at once by its token, the device's
earlier session left as it was, and the sign-in answers 401 as wrong credentials do; an
acceptance that names no session of an account answers 500 `internal`. A sign-in's `start` is
always that of the account it
stands for. Since a reset's or a change's transaction ends every session
present at its commit, a session written before it is ended by it and one written after is ended
by the sign-in itself: no session outlives the password it was opened with. A sign-in that
stands is then admitted against the account's limit of devices, `DEVICE_LIMIT` (10, beside
`SESSION_LIFETIME_MS` in `auth-instance.ts`), in one transaction (`AuthSessions.admit`,
`surql/device-sessions-admit.surql`), one admission of an account at a time in the gateway's
process: the account's devices with a live admitted session are counted, the new session's
device included and a device with several sessions once (`fn::devices_signed_in_with` of the
directory schema, by which a sign-in's code step judges the limit too, before its code is
checked). A sign-in's session is written
`pending` (the sign-in route asks for it with `X-Perch-Admission: pending`, whatever the client
sent, and the session hooks honour it on Better Auth's paths of a sign-in only: `/sign-in/email`,
`/two-factor/verify-totp`, `/two-factor/verify-backup-code` and `/passkey/verify-authentication`)
and waits
until its admission, counted by no other admission and listed among no devices, so a sign-in
still under way takes no place from another. Within the limit the session is admitted, which
ends the device's earlier session and closes the sockets it opened with 1000, as a confirmed
one past it does. Past it, a sign-in whose body does not carry `signOutOldest: true` has its new session
deleted, never handed to the device nor listed among its devices, and answers 409 `device-limit`,
which the web asks the person about; once confirmed, the sign-in signs out the account's other
device seen least recently (`last_seen_at`, then the device's id), whose session ends with
`device-limit` as its reason and whose sockets close with 4003 (`CLOSE.deviceLimit`). The limit is
judged when the sign-in is admitted, not when it was asked: a place freed meanwhile signs no
device out, of two sign-ins for the last place one is admitted and the other asked, and a new
sign-in of a device signed in already takes no place. A 409 counts as a right password for the
email's failed sign-ins, and an admission that fails ends the new session and answers 500
`internal`; should the ending fail too, the session keeps waiting, never handed out, counted,
listed or read. The admission finds the session by its token whatever its ending, and reads the
account's ban in its transaction: a banned account answers 403 `account-banned` with no token
(a right password, so it clears the email's failed sign-ins), its session ended `banned` unless
the ban ended it already, the device's earlier session left to the ban; a ban that commits after
the admission ends the admitted session with every other. Before it, Better Auth's own gate
refuses a session to an account it reads banned (403 `account-banned`); an unverified banned
account is refused its right password as any unverified one (403 `EMAIL_NOT_VERIFIED`, which
Better Auth answers before any session), and a wrong password answers 401 as for any account, so
nobody without the password learns of a ban.

The password step of an account whose second factor is on signs nothing in
(`auth-handler/second-factor-asked.ts`): Better Auth checks the password, writes a session and
deletes it at once (written waiting, it ends none of the device's sessions, and its delete ends
it), and answers with a challenge in its cookie, under `2fa-<random>` in `verification` with the
row counting its codes. The gateway reads the challenge from Better Auth's `set-cookie`, by the name
Better Auth gives the cookie (`TwoFactorChallenges.cookieName`), the account it belongs to from the
challenge's own row (`challengeOwner`: Better Auth's answer names none), and the email's account
again, and holds the step to `signInStands` as a sign-in that wrote a session: a step that stands
answers `200 { secondFactor: { challenge } }`, the challenge in the form Better Auth set it, no
token and no cookie; one that does not (a password changed, an email moved meanwhile) has the
challenge's rows deleted (`endChallenge`) and answers 401 as wrong credentials; one whose account
the second read finds banned has them deleted and answers 403 `account-banned`. A challenge the
answer does not carry, or a read or an ending that failed, answers 500 `internal`, the challenge
handed to nobody. A step whose code never comes (the device closed) leaves the challenge's two rows
behind, which expire after ten minutes but which nothing deletes, Better Auth's own clean-up being
off: so each step that wrote a challenge first reclaims some of those earlier steps left once they
expired more than a minute ago (`TwoFactorChallenges.reclaim`, `reclaimChallenges`: at most
`RECLAIMED_PER_CHALLENGE` (10) rows read, each ending its challenge with the row counting its codes
through `fn::two_factor_challenge_end`, a count whose challenge is gone included; a reclaim that
failed answers 500 `internal` too). The step is where challenges are written, so their backlog
drains at the pace they are made, whatever happens to passkeys. Each of these answers carries what it means for the email's failed sign-ins,
decided where it is made and read again nowhere (`JudgedAnswer`, `auth-handler/sign-in-settlement.ts`):
the challenge and the ban's refusal judge nothing, whatever becomes of the account afterwards (the
right password of such an account is not a sign-in's last step; the right code will be), the 401
counts as a failure. A refusal Better Auth makes after the password and before any challenge (403
`account-banned` or `EMAIL_NOT_VERIFIED`) judges nothing either for an account whose second factor
is on, read again when the refusal is judged, a read that failed counting as on; for an account
whose second factor is off it clears them, as before. A session that
waits for its admission, a sign-in's
or a verification's, is no session to a caller: the caller read (`AuthSessions.read`, behind the
Bearer caller, the password confirmation and the sync hello) reads it as none, so a route answers
401 and a hello closes 4401 as for an unknown token. `signOutOldest` is the gateway's: Better Auth gets the rest of the
body. Better Auth's
clean-up of expired rows is off (`verification.disableCleanup`), so a link past its hour reads as
expired, not unknown: an account keeps one reset link and one pending change of its email at
most, each replaced by the next.

The code step of that sign-in is the gateway's own (`POST /auth/confirm-sign-in` `{ challenge,
email, code, signOutOldest? }`, with the device's headers; `auth-handler/confirm-sign-in.ts`). It
takes one of the address's credential checks, answers 400 `bad-request` for a body it cannot read
(a code outside the contract's length for a code of the second factor, a challenge that is not
one cookie value) or a request that names no valid device, before anything is read or spent, then
judges the email typed at the password step, in lower case, first: it must find a place among the
email's failed sign-ins (429 `rate-limited` while they keep a password out, whatever the
challenge and the code, a dead challenge included). The challenge's account is read from its own
row (`challengeOwner`), and the account the email names must be that one (else 401
`code-expired`: a client that sends another email only spends that email's places). In that
account's turn (`AuthMountDeps.accounts`, by its identity's key, the turn a change or a reset of
the password, the confirmation of a new email, a ban, a deletion and the second factor's settings
take), the challenge's row is read again (gone: 401 `code-expired`) and the account's second
factor (`TwoFactorRows.read`): one that is off, or whose key no code confirmed, ends the challenge
and answers 401 `code-expired` before either verifier runs, since Better Auth's verifier of
backup codes takes the codes of an unconfirmed key too. The step is then judged before its code
is checked, no verifier run on a refusal, so the code, right or wrong, is neither checked nor
spent, nothing is signed in or out and the email's failed sign-ins stay as they were. A challenge
that takes no code any more, judged as Better Auth's verifiers judge it (its rows past their ten
minutes by the process's own clock, as Better Auth reads it, or five codes counted:
`TwoFactorChallenges.takesCode`, `surql/two-factor-challenge-state.surql`), ends and answers 401
`code-expired` first, and so does one that ends within `CODE_CHECK_MARGIN_MS` (15 s): Better
Auth's verifier of backup codes writes the account's codes without the one given before it spends
the challenge, so a challenge expiring in between would use the code up with nothing signed in. Then the
sign-in is judged as its admission would judge it (`AuthSessions.judge`,
`surql/device-sessions-limit.surql`, in the account's turn of admissions, its devices counted as
the admission counts them, writing nothing): a banned account ends the challenge and answers 403
`account-banned`, at both steps of the dialog alike; a device that would bring the account past
its limit of devices, on a step without `signOutOldest: true`, ends it and answers 409
`device-limit`, and the dialog's confirmation signs in again from the password, which asks for a
code again. A confirmed step is not asked about the limit: its code is checked, and a backup code
spent, before anyone is signed in or out. The code then goes to Better Auth's
verifier, six digits to `/two-factor/verify-totp` and any other code to
`/two-factor/verify-backup-code`, by the gateway's own call (`internalRequest`, the challenge its
only cookie, the session it writes waiting for its admission), and Better Auth's answer is read by
its code alone: a wrong code is 400 `invalid-code` and counts as a failed sign-in; a challenge
spent, ended, past its ten minutes or after five wrong codes, and a factor Better Auth finds not on,
are 401 `code-expired` (the sign-in starts again from the password); the admin plugin's refusal of
a banned account's session is 403 `account-banned`; anything else is 500 `internal`. An accepted
code is admitted as a sign-in by password is (`admitted`, `auth-handler/admitted.ts`, the back half
of both: the limit of devices and the ban judged now, the device's sockets closed, the answer
`{ token, user, start? }` built from the allowlist, no header of Better Auth's answer copied, its
`set-auth-token` and cookies included), with the start of the account the email names, read in
the turn. A right code is the sign-in's last step: 200 forgets the email's failed sign-ins, and so
does the admission's own 409 `device-limit`. Every other answer gives its place back, the 409
judged before the code and a ban's refusal included, so a banned account's right code forgets
nothing. So a backup code is used up only by a sign-in that goes through, with one exception: a
device's session of the account renewed, or a device admitted through a door that does not take
the account's turn, at any moment after the gateway's judgment and before the admission counts the
devices, after Better Auth's answer included, can make the admission answer 409 `device-limit`
once the code was checked; that late 409 uses the code up with nothing signed in and, as a right
code, forgets the email's failed sign-ins. A ban cannot fall in that interval through the
console, whose ban takes the account's turn the code step holds; only a writer outside that turn
could make it. The challenge's deadline does not use a code up: the margin refuses a challenge
that could expire during the check before any code is checked. A change of what a challenge stood for ends it in its own transaction: a change
or a reset of the password, the confirmation of a new email, the second factor turned off and the
account's deletion each end the identity's pending challenges with the rows counting their codes
(`fn::two_factor_challenges_end`), so a code step that waited for their turn answers 401
`code-expired`, and one whose turn came first signs in and is then ended as any other session of
the account by a change or a reset of the password (left by the confirmation of an email and by the
factor turned off). Two code steps of one account, a backup code spent twice or beside a renewal of
the codes, run one after the other: one signs in, the other is a wrong code.

A device signs in by passkey in two halves, with its headers and no token
(`auth-handler/passkey-sign-in.ts`). `POST /auth/passkey-options` answers 200 `{ options,
challenge }`: the passkey plugin's options of a sign-in (`/passkey/generate-authenticate-options`,
a bodyless GET of the gateway's own), which name no credential, so every passkey is a discoverable
one, with `userVerification` set to `required` where the plugin only prefers it, and the plugin's
challenge cookie as `challenge` (`ceremonyOf`, `auth-handler/passkey-ceremony.ts`; the cookie's
name from Better Auth's `createAuthCookie`, `PasskeyChallenges`), never set on the gateway's own
answer. `POST /auth/sign-in/passkey` `{ response, challenge, signOutOldestFor? }` answers 400
`bad-request` for a body it cannot read or a request that names no valid device before anything is
read or the challenge spent; it then reads the passkey's account by the assertion's credential
(`PasskeyRows.ownerOf`: none is 401 `passkey-unknown`, the plugin not asked) and runs in that
account's turn, so a removal of the passkey, a ban, a deletion and a reset commit wholly before or
after it: the plugin's verifier (`/passkey/verify-authentication`, the challenge its only cookie,
the session it writes waiting for its admission) reads the passkey itself (one removed before the
turn: 401 `passkey-unknown`) and is read by its code: an authenticator that did not verify its user,
a signature that does not verify, and a challenge spent, ended or past its five minutes are 400
`failed`; the admin plugin's refusal of a banned account's session is 403 `account-banned`;
anything else is 500 `internal`. No password or code is asked, whatever the account's second
factor, and the email's failed sign-ins never keep it out (no place is taken among them): a
verified passkey is the sign-in's last step, so it forgets them (`RequestLimits.
forgetFailedSignIns`, the account's email in lower case) before the admission (`admitted`, with
the start of the account its email names). A sign-in the limit of devices asks about answers 409
`{ code: 'device-limit', consentFor }`, naming the account it asked about; a retry signs the
device seen least recently out only when `signOutOldestFor` names the account of the passkey it
verifies, so a passkey of another account picked on the confirmation is asked about afresh. A
removal whose turn came after the sign-in's ends no session. A verifier that wrote the session and
then failed (its read of the account to answer with, say) verified the passkey: the failure is the
service's, so the gateway ends that session, which nobody was handed (the session hooks note each
session written for the gateway's call that wrote it, `noteSessionWritten` and
`watchingSessionWrites` in `session-writes.ts`), and answers 500 `internal`, whatever code the
plugin gave; a verified passkey whose account the gateway then fails to read back (its start, for
the admission) has its session ended and answers 500 alike. Either ending is best effort: one that
fails too still answers 500 and leaves the session waiting for an admission it never gets, handed
to nobody, counted by no admission, listed nowhere and read by no caller.

A ceremony a device starts and leaves (its browser window closed) leaves the plugin's row in
`verification`, which expires after five minutes but which nothing deletes, Better Auth's own
clean-up being off to keep a reset link readable as expired. So each start of a ceremony, a
registration's options and a guest's alike, first reclaims at most `RECLAIMED_PER_CEREMONY` (10)
of the passkey ceremonies that expired more than a minute ago (`PasskeyRows.reclaim`, one
statement: the rows whose JSON value is the plugin's registration or sign-in, the minute keeping a
ceremony Better Auth still takes out of reach of a database clock a little ahead), so a backlog of
abandoned ones drains over the next starts. The read that finds them is bounded too: the schema
marks each row of `verification` with the kind of ceremony it belongs to (`ceremony`: `passkey`,
`two-factor`, none for every other row) and indexes the ceremonies by kind and expiry
(`verification_ceremony_expiry`), so each reclaim, a password step's of two-factor challenges
included, reads the expired rows of its kind, the earliest first, and no other row. No row of
another kind (a reset link, a pending change of an email or deletion of an account, a two-factor
challenge) is touched, so a reset link past its hour still reads as expired.

A signed-in device changes its password with `POST /auth/change-password` `{ currentPassword,
password }`, its token and `X-Perch-Device` (400 `bad-request` without a valid device, 401
`unauthorized` for a token that holds no live session of it). It takes one of the address's
credential checks, answers 400 `bad-request` for a body without a current password, 400
`password-rejected` for a new password that breaks the rules,
and must find a place among the account's 10 failed sign-ins in 15 minutes, as a sign-in does
(429 when they are spent): a wrong current password keeps its place there and answers 400
`invalid-credentials`, as one of a length no account's password has does without being checked;
a right one gives its place back and forgets none of the failures (only a sign-in's last step
does). In the account's turn, the current password is
checked against the credential row and the new one hashed (`AccountPasswords.change`); then one
transaction (`surql/password-change-commit.surql`) makes sure the caller's session is still live
(401 `unauthorized` when it ended while the change waited) and the row still holds the hash that
was checked, and sets the new password, ends every other session of the account, every reset link,
the pending change of its email and its pending two-factor challenges: all of them or none (500
`internal` with nothing changed).
Once it committed, the sockets of the devices whose session it ended close with 4002, the
caller's own session and sockets staying, and the notice starts: 204 with no body. Better Auth's
`/change-password` is not used: it sets the password apart from the endings.

A signed-in device asks to change its email with `POST /auth/change-email` `{ email, password }`,
its token and `X-Perch-Device`. After a credential check of its address, a body without a
password answers 400 `bad-request` and a new email that is not
an email (empty, longer than the `email` value's length, or of any other shape) answers 400
`email-invalid`; then one of the address's mails and one of the account's 3 changes in 15 minutes are taken
(429). Everything after runs in the account's turn, so no reset or change of the password runs in
between: the caller's session is read again (401 `unauthorized` when it ended while the request
waited), with the account's email as it is then, and the password must find a place among that
email's failed sign-ins and match the credential row (`AccountPasswords.matches`), a wrong one
answering 400 `invalid-credentials`, as one of a length no account's password has does without
being checked, and a right one giving its place back and forgetting none of the failures. Its
earlier pending change then ends; when no account has the
new email (the account's own counts as taken), a new change
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
the account and then of the new email (so no sign-up of the new email runs meanwhile), the token
is judged again on the clock as it is then (401 `link-expired` when it expired while the
confirmation waited), the pending change the token names is spent (`EmailChanges.claim`, once),
and the account's email
becomes the new one, verified, only while it is still the email the change was asked from, every
reset link of the account and its pending two-factor challenges ending with it in one transaction,
since they went to, or were answered for, the old email (`EmailChanges.move`): 401 `link-invalid` when the change was not pending (used before, replaced
by a newer one, or ended by a change of the password), when the account's email changed since, or
when the new email has got an account meanwhile. The new email is verified because its link was
opened from its mailbox: an account whose own email never was (a change an operator asked for,
`src/console/README.md`) signs in with the new one from then on, and its first sign-in starts it.
Once it changed, the notice of a changed email
starts to the old email, written from the old email, the account's name and language alone
(`AccountMails.emailChanged`), and it answers 200 `{ identity, email }`, the account whose email
changed and its new email. Sessions stay: a session's caller reads the account's email afresh,
so every device's next call and hello sees the new one. Every device shows the `email` of the
profile in the identity's private region, which the devices create but never change, so the
gateway writes the new email there (`ProfileEmails`, `profile-emails.ts`). The confirmation asks
for the write (`queue`), which runs in the account's next turn, once the confirmation's ended,
so the answer and its time do not depend on it and a later change of the email follows after it;
it writes the identity's email as it is then (`follow`), so a late write never puts an older email
back. That write lives in the process only, so a gateway that stops between the move and the
write would lose it: every hello of a device of the account also compares the identity's email
with its profile's in the directory, one read after the welcome that the welcome does not wait
for, and queues the write when they differ (`reconcile`). After a restart every device says hello
again, so the first one brings the profile in step with no other confirmation; a profile a device
created with an email the account no longer has is brought in step the same way, at the next hello
of any of its devices. The profile is found by its identity in the
directory, where the region hub projects the region's rows, so a profile under any id is found;
the write is the hub's own change (`RegionHub.writeRecord`), logged, projected and sent to every
subscribed device like a device's batch, and a device that was offline gets it at its next pull.
A write that changes nothing logs nothing. An account with no profile in the directory yet (no
device's start has reached the server) gets nothing written, logged as a warning
`auth:PROFILE_NOT_STARTED`: the device that starts it later creates the profile from the
account's email as it is then (a sign-in's `user.email`, a verification's answer). A write that
fails is tried once more, then logged by its code; one the hub refuses is logged at once. The
confirmation answered 200 already: the email did change.

The mails of a reset, a confirmation, a deletion and the three notices (`account-mails.ts`,
written by `@workspace/email`) start at once and never hold the request, and speak the account's
language, as the verification mail does: its settings' once it has settings, its sign-up's
before; settings that could not be read send nothing (`mail:LOCALE_UNREADABLE`), and a mail that
could not be read, written or sent is logged by its code, never with its address, its name or its
link. A notice of a changed password links to the front's `/forgot-password`; the notices of a
changed email and of a deleted account carry no link. Every mail about an account reads whom it
goes to in one place (`accountAddressee`, `account-addressee.ts`): the account's email, its own
name and that language. The notice of a deleted account is the one exception: it is written from
the addressee read before the account went (`AccountTeardown.addressee`) and reads nothing.

A signed-in device asks to delete its account with `POST /auth/request-account-deletion`
`{ password }`, its token and `X-Perch-Device`. After a credential check of its address (429) and
a body it can read, with a password (400 `bad-request`), one of the address's mails and one of the account's 3
requests in 15 minutes are taken (429). In the account's turn the password is confirmed as for a
change of the email (`password-confirmation.ts`, shared by both: the session read again, 401 when
it ended meanwhile; a place among the email's failed sign-ins, 429; a wrong password 400
`invalid-credentials`, kept as a failure; a right one gives its place back and forgets none of the
failures). An account that is the only admin of a ready
organisation with other members answers 409 `last-admin` and gets no mail. Any other keeps its
deletion as the pending one (`AccountDeletions.ask`: one row per identity in `verification`,
`delete-account:<identity key>`, replacing an earlier one), and the mail to the account's own
email starts in its language, its link the front's `/delete-account?token=…`
(`AccountMails.deleteAccount`): 202 with no body. The request has no floor: it concerns the
caller's own account, and its answer tells nothing of others. The link only opens a page; the
account goes on the press of that page's button, `POST /auth/delete-account` `{ token }`, with no
session needed. It takes one of its address's 20 attempts in 10 minutes first (429), then answers
401 `link-invalid` for a token the gateway did not sign as a deletion (the token is a JWT signed
with a key derived from the auth secret, `account-links/deletion-token.ts`, so neither Better
Auth's verification nor the confirmation of an email takes it, nor it one of theirs) and 401
`link-expired` for one asked an hour ago or more (`DELETION_LINK_LIFETIME_MS`). In the account's
turn the token is judged again on the clock as it is then. The rest runs in the turns of the
account's memberships (`Organisations.leaveAll`, `src/tenants`), whose check, made from the rows
as they are there, is the one that decides: an account that is the only admin of an organisation
with other members answers 409 `last-admin` with nothing changed, its link still pending and its
sessions alive, so the same link deletes it once another member is made an admin or those
members are removed, an invitation that overtook the press included. Only once the departure is allowed, and before it writes anything,
does the deletion take effect (the departure's `before` step): the token is judged once more on
the gateway's clock, as the departure may have waited for an organisation's turn past the link's
hour (401 `link-expired`, nothing changed), and the pending deletion is spent
(`AccountDeletions.claim`, once, and only before its `expires_at` on the gateway's clock: 401
`link-invalid`, nothing changed, when it was used, replaced, or ended by a change of the password
or of the email), whom the notice goes to is read while the
account exists (`AccountTeardown.addressee`), every session of the account ends
(`AuthSessions.revokeAll`) and every socket of it closes with 4001. The departure then takes the
account out of its organisations and its own rows are removed (its `after` step,
`AccountTeardown.remove`) while those turns are still held, so no invite of it and no creation
by it lands in between: one that waited finds the identity gone and is refused. Once the rows
went, every socket of the account closes with 4001 once more: a sign-in takes no turn of the
account, so a device can sign in while the departure runs and say hello before the rows go; the
second close ends its socket, and the registry's epoch it moves refuses a hello still under way
(one that starts later reads no session).
The notice of a deleted account then starts to the email it had (`AccountMails.accountDeleted`),
and it answers 200 `{ identity }`, so the page can tell whether its device was signed in to the
deleted account. A failure of the gateway answers 500 `internal`. Better Auth's own deletion of a
user (`/delete-user`) stays off and out of reach.

A deleted account leaves no row of itself in the directory (`AccountTeardown`,
`account-teardown.ts`). Whom its notice goes to is read first, while the account exists
(`addressee`, as every mail reads it). Then one transaction (`remove`,
`surql/account-teardown.surql`) deletes its sessions, its credential row, its pending change of
email, its pending deletion and its reset links, its pending two-factor challenges with the rows
counting their codes (`fn::two_factor_challenges_end` of the directory schema, the one statement of
that deletion, which every change of what a challenge stood for calls in its own transaction), its
passkeys' pending registrations, its second factor, its passkeys, its profile and settings, and the
server's copy of its private region (head, snapshots, update log, projected records, bound peers),
the identity last: all of them or none, and removing an account that is gone already succeeds and changes
nothing. The caller ends the account's sessions and closes its sockets first, so its private
region is idle (an idle region unloads without writing, and the region hub is not asked), and
takes the account out of its organisations first (`Organisations.leaveAll`, `src/tenants`): the
removal touches no membership, organisation or organisation database, and refuses an identity
that still has a membership, with nothing deleted.

Nothing Better Auth reports reaches a log as it said it. Its logger and its error hook are the
gateway's (`auth-log.ts`): an error is logged as a code from a fixed table
(`auth:CREATE_USER_FAILED`, `auth:CREATE_SESSION_FAILED`, `auth:BACKGROUND_TASK_FAILED`, else
`auth:LIBRARY`) or by Better Auth's own code (`auth:<CODE>`, `auth:UNEXPECTED` when it names
none), with a fixed message; its words, its arguments and an error's cause are dropped, and its
warnings (a wrong password, an unknown email) are not logged. A failure that is not one of
Better Auth's answers, such as a query that failed, is answered by Better Auth 500 with no body,
which the mount passes on as `internal`: Better Auth's router would otherwise print it whole to
stderr, the query's bindings with it. A write of a passkey or of a session the directory did not
take is logged as `auth:STORAGE_FAILED` where it failed (`storageFailuresTold`), since Better Auth
answers its own errors without handing them to its error hook. SurrealDB's
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
  device's later session keeps its sockets. An id longer than the `id` value allows
  (`src/path-id.ts`) answers 400 `bad-request` before any session is looked for; any other id that
  is not one of the caller's sessions answers 404 `no-such-device`.
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

The routes of the signed-in account's second factor (`two-factor.routes.ts`, `TWO_FACTOR_PATHS`)
come right after the device routes in the server and act for the same Bearer caller. They are the
gateway's own and call none of Better Auth's endpoints that replace the caller's session: its
turning off of a factor and its confirmation of a code, made while signed in, each write a new
session and delete the caller's, so the account's other devices' bearers would no longer match.
Here the caller's session is never touched, and a spec holds that the same Bearer reads
`GET /devices` after each change. Each change takes one of the client address's credential checks
(429 `rate-limited`) and a body it can read (400 `bad-request`), then runs in the account's turn
(`GatewayRoot.accountTurns`, by the identity's key), the session read again inside it, so a sign-in's
code step, a change of the password and another change of the factor do not interleave with it. A
password the request confirms is checked as a change of the password's is (`confirmPassword`: 400
`invalid-credentials`, counted among the email's failed sign-ins, 429 once they are spent; a right one gives its place
back and forgets none of them, as at every confirmation of a password in the settings).

- `GET /two-factor`: 200 `{ enabled }`.
- `POST /two-factor/enable` `{ password }`: 403 `failed` when the policy does not allow the account
  a second factor (`SecondFactorPolicy.decide`), before the password is looked at; then the
  password, then 409 `two-factor-changed` while the factor is on. Otherwise Better Auth, called on
  the server with the caller's session (`auth.api.enableTwoFactor`, which checks the password too
  and rotates nothing), makes a new key and ten backup codes and replaces the account's key of an
  earlier enable that was never confirmed; the answer is 200 `{ key, uri, backupCodes, enrolment }`:
  the key as the text an authenticator app is given (the base32 `secret` of the `otpauth://` URI,
  `keyShown`), the URI, the ten codes, shown once, and the enrolment, the id of the account's new
  two-factor row read after Better Auth answered. The factor stays off.
- `POST /two-factor/confirm` `{ code, enrolment }`: a code outside the contract's length for a
  code of the second factor, or an enrolment that is not an id of a two-factor row, answers 400
  `bad-request`. In the turn, an enrolment that is not the account's row (replaced by a later
  enable, deleted by a turning off, never written) or a factor that is on already answers 409
  `two-factor-changed` whatever the code. The code is then checked against the row's key: the
  secret decrypted with Better Auth's `symmetricDecrypt` and the code compared by its `createOTP`
  (`keyAccepts`, the check of Better Auth's own verification without the session it replaces), a
  wrong one answering 400 `invalid-code`; a right one turns the account's flag on and marks the row
  verified in one transaction (`two-factor-confirm-commit.surql`, which checks the row and the flag
  once more): 204.
- `POST /two-factor/disable` `{ password }`: 403 `failed` while the policy requires the factor,
  then the password; one transaction turns the flag off, deletes the account's two-factor row and
  ends its pending sign-in challenges with the rows counting their codes
  (`two-factor-disable-commit.surql`, calling `fn::two_factor_challenges_end`): 204, and 204 alike
  for an account whose factor was off already.
- `POST /two-factor/renew-codes` `{ password }`: the password, then 409 `two-factor-changed` while
  the factor is off (a key waiting for its code included); otherwise Better Auth makes ten new
  codes (`auth.api.generateBackupCodes`, on the server with the caller's session) and the earlier
  ones are refused from then on: 200 `{ backupCodes }`.

The policy of the second factor is a port (`SecondFactorPolicy`, `second-factor-policy.port.ts`):
`decide(identity)` answers `{ allowed, required }`, asked before a turning on (`allowed`) and a
turning off (`required`). Its one adapter, `accountChoicePolicy`
(`second-factor-policy.account-choice.ts`), lets each account choose: allowed, never required; a
later policy, an organisation's, replaces it in the composition root. A refusal by the policy is a
403 `failed`: the contract names no code for it until an organisation can require the factor.


The routes of the signed-in account's passkeys (`passkey.routes.ts`, `PASSKEY_PATHS`, their
handlers in `passkey-handlers.ts`) come after those of the second factor and act for the same
Bearer caller. A registration's two calls and a removal each run in the account's turn, the
caller's session read again inside it (401 `unauthorized` when it ended while the request
waited), so a deletion of the account, a ban or a reset commits wholly before them (nothing
written) or after them (a deletion takes the passkeys and the pending registrations with the
account; a ban or a reset leaves them, the ban refusing the account's sign-ins). A sign-out or a
revocation takes no turn: the plugin's own read of the session is their boundary, so one before
it answers 401 and one after it lets the call finish, as one made just before it would. The
registration's calls reach the passkey plugin by the gateway's own calls with the caller's token,
its challenge cookie carried by the device as `challenge`.

- `GET /passkeys`: 200 `[{ id, createdAt }]`, the account's passkeys, the earliest added first
  (`PasskeyRows.list`).
- `POST /passkeys/options`: 200 `{ options, challenge }`, the plugin's options of a registration
  (`/passkey/generate-register-options`, a bodyless GET; a discoverable credential, its user
  verified, the account's passkeys excluded) and their challenge, once some of the ceremonies left
  unfinished were reclaimed.
- `POST /passkeys` `{ response, challenge }`: the authenticator's answer to the plugin's verifier
  (`/passkey/verify-registration`, the challenge its only cookie): 201 once it is the account's
  passkey; 400 `failed` for an answer the plugin refused (an authenticator that did not verify its
  user, a challenge spent, of another account or past its five minutes, an answer that does not
  verify), nothing kept; 500 `internal` for an answer that verified but whose passkey the directory
  did not take; 400 `bad-request` for a body that names no answer or no challenge of one cookie
  value.
- `DELETE /passkeys/:id`: 204 once the account's passkey is removed (`PasskeyRows.remove`; it signs
  nothing in from then on, and the devices it signed in stay signed in); 404 `failed` for an id that
  names none of the account's, another account's included; 400 `bad-request` for a text that is not
  a passkey's id, before any passkey is looked for.
## Surface

- Routes: `POST /auth/sign-up/email`, `POST /auth/sign-in/email`, `POST /auth/verify-email` and
  `POST /auth/send-verification-email`, Better Auth's behind the mount, and
  `POST /auth/confirm-sign-in` (`confirmSignIn`, `CONFIRM_SIGN_IN_PATH`, `CODE_CHECK_MARGIN_MS`,
  `confirm-sign-in.ts`),
  `POST /auth/request-password-reset`, `POST /auth/reset-password`, `POST /auth/change-password`,
  `POST /auth/change-email`, `POST /auth/confirm-email`, `POST /auth/request-account-deletion` and
  `POST /auth/delete-account`, the mount's own (`authHandler`, `AuthMountDeps` and
  `AccountDepartures`, `auth-handler/`: the mount, the sign-up and its floor, `SIGN_UP_FLOOR_MS`, the
  sign-in, the verification and the resend, the request for a reset mail and its floor
  `RESET_REQUEST_FLOOR_MS` and the reset (`password-reset.ts`), the change of a password
  (`password-change.ts`), the change of an email and its floor `CHANGE_EMAIL_FLOOR_MS` and its
  confirmation (`email-change.ts`), the request to delete an account and the deletion
  (`account-deletion.ts`), the confirmation of a signed-in caller's password
  (`password-confirmation.ts`), what follows a new password (`password-changed.ts`), the
  Bearer caller of the mount (`signed-in.ts`), the floors' wait (`src/floor.ts`, which the invite of the organisation routes waits on too), the
  admission and answer of an accepted sign-in (`admitted` and `acceptedSession`, `admitted.ts`),
  the close of a device's sockets (`closeDevice`, given the parsed device, the verified identity
  and the reason), and the requests and
  refusals as Better Auth and the client get them (`refusalOf`, `refusalCodeOf`, `BANNED_USER`)),
  which one account's turns serialise (`GatewayRoot.accountTurns`, a `KeyedTurns` by the email in
  lower case or by the identity's key); `GET /devices`, `DELETE /devices/:id`,
  `POST /auth/sign-out` and `POST /auth/sign-out-everywhere` (`deviceRoutes`,
  `device.routes.ts`); `GET /two-factor`, `POST /two-factor/enable`, `POST /two-factor/confirm`,
  `POST /two-factor/disable` and `POST /two-factor/renew-codes` (`twoFactorRoutes` and
  `TwoFactorRoutesDeps`, `two-factor.routes.ts`); `GET /passkeys`, `POST /passkeys/options`,
  `POST /passkeys` and `DELETE /passkeys/:id` (`passkeyRoutes` and `PasskeyRoutesDeps`,
  `passkey.routes.ts`, the handlers in `passkey-handlers.ts`); the mount's `POST
  /auth/passkey-options` and `POST /auth/sign-in/passkey` (`passkeyOptions`, `signInWithPasskey`,
  `PASSKEY_OPTIONS_PATH` and `PASSKEY_SIGN_IN_PATH`, `auth-handler/passkey-sign-in.ts`). The paths
  the mount answers (`MOUNT_PATHS`), those the device routes answer (`DEVICE_PATHS`), those of the
  second factor's routes (`TWO_FACTOR_PATHS`) and those of the passkeys' (`PASSKEY_PATHS`) are
  listed beside their handlers, for the spec that holds the routes to the platform's actions; the
  device routes, the second factor's and the passkeys' answer a path only through their list
  (`src/route-path.ts`).
- Close code: 4002 (`CLOSE.passwordChanged`) on the sockets of a device whose session a reset or
  a change of the password ended, so the device can tell its person why it was signed out; 4003
  (`CLOSE.deviceLimit`) on those of the device a confirmed sign-in past the account's limit of
  devices signed out; 4001 stays a sign-out from another device. 4004 (`CLOSE.banned`) is what a
  hello hears for a session an operator's ban ended (`ended_reason` `banned`).
- Headers: `Authorization: Bearer <token>`, `X-Perch-Device` (`DEVICE_HEADER`) and, at sign-in,
  at its code step, at a passkey sign-in and at verification, `X-Perch-Device-Label` (`DEVICE_LABEL_HEADER`, at most 60
  characters as `deviceLabel` takes it).
- Services: `createAuthInstance` and `authOptions` (`auth-instance.ts`: Better Auth's options,
  which the schema check reads too, `SESSION_LIFETIME_MS`, `DEVICE_LIMIT` and
  `VERIFICATION_LINK_LIFETIME_S`),
  `AUTH_MODELS` and `generateAuthId` (`auth-models.ts`), `hashPassword` and `verifyPassword`
  (`password-hash.ts`), `AuthLog`, `authLogger` and `authErrorReporter` (`auth-log.ts`),
  `verificationMailer`, `verificationLink` and `VERIFY_EMAIL_PATH` (`verification-mail.ts`),
  `resetMailer` and `RESET_LINK_LIFETIME_S` (`reset-mail.ts`), `AccountMails`,
  `RESET_PASSWORD_PATH`, `CONFIRM_EMAIL_PATH`, `DELETE_ACCOUNT_PATH` and `FORGOT_PASSWORD_PATH`
  (`account-mails.ts`),
  `AccountPasswords` (`account-passwords.ts`: `requestReset`, `hash`, `reset`, `change`,
  `matches`), `ResetLinks` (`read`, `keepNewest`), `EmailChanges` (`ask`, `cancel`,
  `read`, `claim`, `move`; `CONFIRMATION_LINK_LIFETIME_MS`), `AccountDeletions` (`ask`,
  `cancel`, `read`, `claim`; `DELETION_LINK_LIFETIME_MS`: the one pending deletion link of an
  account, which a change of the password or of the email ends) and the token of a verification
  link (`signVerificationToken`, `readVerificationToken`, `verificationKey`) (`account-links/`),
  `ProfileEmails` (`profile-emails.ts`: `queue`, `reconcile`, `follow`), `accountLocale`
  (`account-locale.ts`), `accountAddressee` and `addresseeFailure` (`account-addressee.ts`: whom a
  mail about an account goes to, and the code logged when it could not be read), `AccountTeardown` (`account-teardown.ts`: `addressee`, `remove`;
  `DeletedAccount`),
  `adminPlugin` (`admin-plugin.ts`: Better Auth's admin plugin as the gateway runs it),
  `SecondFactorPolicy` and `SecondFactorDecision` (`second-factor-policy.port.ts`) with its adapter
  `accountChoicePolicy` (`second-factor-policy.account-choice.ts`, built by the composition root as
  `GatewayRoot.secondFactorPolicy`), `TwoFactorRows` (`two-factor-rows.ts`: `read` the account's flag
  and key, `confirm`, `disable`; `TwoFactorState`, `TwoFactorKey`, `TwoFactorConfirmation`; the
  root's `twoFactorRows`, which the mount reads at a code step as `AuthMountDeps.twoFactor`, beside
  the front's origin of its own calls, `AuthMountDeps.publicUrl` from the root's `publicUrl`),
  `keyShown` and `keyAccepts` (`two-factor-key.ts`),
  `confirmPassword`, `signedIn`, `stillSignedIn` and `MountCaller` (`auth-handler/`, through the
  folder's index, which the second factor's routes use beside the mount),
  `passkeyPlugin`, `refuseUnverifiedRegistration`, `refuseUnverifiedAuthentication` and
  `USER_NOT_VERIFIED` (`passkey-plugin.ts`: Better Auth's passkey plugin as the gateway runs it, its
  two hooks and the code of their refusal), `storageFailuresTold` and `STORAGE_FAILED`
  (`storage-failures.ts`: the adapter with a failed write of a passkey or a session told apart),
  `noteSessionWritten` and `watchingSessionWrites` (`session-writes.ts`: the sessions Better Auth
  wrote during a call of the gateway's, noted by the session hooks),
  `PasskeyRows` (`passkey-rows.ts`: `list` an account's passkeys, `ownerOf` a credential, `remove`,
  `reclaim` the ceremonies left unfinished; `ListedPasskey`, `PasskeyRemoval`,
  `RECLAIMED_PER_CEREMONY`; the root's `passkeyRows`, which the mount reads at a passkey sign-in and
  at a guest's options as `AuthMountDeps.passkeys`),
  `passkeyChallenges` (`PasskeyChallenges`: `cookieName`; the root's `passkeyChallenges`, the
  mount's too) and `ceremonyOf` (`Ceremony`) (`auth-handler/passkey-ceremony.ts`, through the
  folder's index),
  `challengeValue`, `setCookieValue`, `challengeOwner`, `challengeTakesCode`, `endChallenge`,
  `internalRequest` (`InternalCall`) and
  `reclaimChallenges` and `RECLAIMED_PER_CHALLENGE`,
  `twoFactorChallenges` (`TwoFactorChallenges`: `cookieName`, `ownerOf`, `takesCode`, `end`,
  `reclaim`; the mount's `challenges`, built by the composition root)
  (`auth-handler/challenge-cookie.ts`; all but `challengeOwner`, `challengeTakesCode`,
  `endChallenge`, `reclaimChallenges` and `RECLAIMED_PER_CHALLENGE` also through the folder's
  index), `secondFactorAsked`
  (`auth-handler/second-factor-asked.ts`),
  `ADMIN_PATHS` (`admin-paths.ts`: the path of every endpoint of that plugin), `rolesOf`
  (`platform-roles.ts`: the platform roles of an account's stored role),
  `sessionHooks` (`session-hooks.ts`), `AuthSessions`
  (`auth-sessions/`: `read` a session by its token,
  `signOut`, `revoke`, `revokeAll`, `admit` a sign-in against the limit of devices and the ban
  (`SignInAdmission`), `judge` a sign-in as `admit` would take it, before its session is written
  (`SignInJudgment`), `admitVerified` a verification's session against the ban
  (`VerifiedAdmission`), and for a verification `signedIn`,
  `identityOf` and `verificationOf`; `SignedInAccount`, `MailedVerification`), `DeviceSessions` (`device-sessions.ts`: `list`,
  `byToken`, `seen`) over the rows of `device-session-rows.ts`, the Bearer caller
  (`bearerCaller`, `bearerToken` and `bearerRefused` in `bearer-caller.ts`, also used by the
  organisation routes, and the caller's email and session row besides), `accountEmail`
  (`account-email.ts`, an email as the invitations take it, at most the `email` value's length, the
  longest an email in any body may be), `profileNameOf` (`profile-name.ts`: a name as a profile
  takes it, as a sign-up and an operator's rename hold it) and `identityByEmail`
  (`identity-by-email.ts`: the one lookup of an identity by its email, in any case, answering its
  key and email or none; `AuthSessions.identityOf` and the organisations' invites use it, each
  deciding what none means).
- Queries: `surql/` (a row by its token, the rows of an identity's devices, the sweep of rows
  that ended 30 days ago, the mark of a device seen, the three endings of `AuthSessions`, the
  ending of all but a device's newest session for a row written admitted, a sign-in's admission
  against the limit of devices and a verification's admission (each reading the account's ban and
  ending the same), a sign-in's judgment against the ban and the limit before its session is
  written, the language an account's settings
  name, the identity of an email, an identity's email, name and language for a mail, an
  identity's email and the key and email of its profile, a reset
  link read and the earlier links ended, a pending change of the email kept, ended and spent,
  the move of an identity's email with the end of its reset links and two-factor challenges, the
  hash on a credential
  row, an email's account, its hash, its ban, whether its second factor is on and its start as a
  sign-in reads them, the account of a two-factor challenge, what tells whether one takes a
  code, the end of one and the reclaim of those left unanswered, an account's second
  factor read (its flag and its key), the confirmation of a code of its key and the turning off of
  the factor (each one transaction), the two transactions of a
  new password: a reset's and a change's, each ending the account's two-factor challenges, an
  account's passkeys, the account of a passkey's credential, the removal of a passkey and the
  reclaim of the passkey ceremonies left unfinished, and the removal of a deleted account's rows).
- Tables: `identity` (the admin plugin's `role`, `banned`, `ban_reason` and `ban_expires`, and
  the two-factor plugin's `two_factor_enabled`, among its columns), `account`, `device_session`
  (the admin plugin's `impersonated_by` among its columns), `verification` (with the schema's
  `ceremony` column and the index of the ceremonies' expiry beside Better Auth's), `two_factor` (with
  the schema's functions `fn::two_factor_challenge_end` and `fn::two_factor_challenges_end`) and
  `passkey` of the directory schema
  (`database/schema/directory/`), which `auth-schema.spec.ts` holds to Better Auth's own for
  these options; a deleted account's rows of `profile`, `settings` and the `_replica_*` tables of
  its private region are removed here too.
- Built by the composition root, `src/composition/root.ts`.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs on an embedded in-memory directory
  (`auth-handler/mount.spec.ts` and `auth-handler/verification.spec.ts`, which also hold that
  nothing of an address, a token or a link reaches a log, stderr or an answer, a failed query's
  included, that one account's verifications at once sign one device in, that a link verifies only
  the account its mail went to (an email freed by a confirmation and taken by a new sign-up
  included), that a verification whose account a reset recovered, or whose email left the
  account, while Better Auth wrote the session leaves no session and answers none, that a device's
  sockets close only once its verification's session is admitted, and stay open when the readback
  fails, that every resend answers no sooner than
  Better Auth's floor, and that every endpoint of the admin plugin answers 404 `not-found`, by
  GET and by POST; `auth-instance.spec.ts`, which also holds that every one of them is switched
  off in Better Auth's handler, read from the configured plugin's table, and answers 404 there,
  an operator's request included, changing nothing, and that a verification's session is written
  waiting for its admission; `auth-handler/sign-in.spec.ts`, which also holds that a sign-in
  answers its allowlist alone, whatever else Better Auth's answer carries, and the refusals of a
  banned account (403 `account-banned` after the right password, before the device is looked at,
  `EMAIL_NOT_VERIFIED` while unverified, 401 for a wrong password, the failed sign-ins cleared),
  and the refusals before the password (origin, Fetch Metadata, callback) that keep them,
  its admission held while a ban commits, before and after the session's insert, answering 403 with
  no token and the session ended `banned`, and the password step of an account whose second factor
  is on: the challenge alone, no token and no cookie, the right password neither counted nor
  forgetting, a device signed in keeping its session, the session Better Auth writes and deletes
  left ended and waiting, a password changed or a ban committed between Better Auth's answer and the
  second read (held) answering 401 or 403 with the challenge gone, that 403 judging nothing even
  when the account is deleted before the step is settled (held), and a banned account's refusal
  forgetting nothing, its second factor read when the refusal is judged;
  `auth-handler/confirm-sign-in.spec.ts` (the code step over a real Better Auth: a wrong code
  counted and the right one kept out while the failures keep a password out, then taken on the same
  challenge once the window passed, the right code signing the device in with the allowlist alone
  and forgetting the failures, a backup code taken once, the code after five wrong ones, a challenge
  past its ten minutes, a backup code on a challenge ending within the margin of a code check
  answered 401 and kept, then taken on one just outside it, a dead, made-up or other email's
  challenge answering 401 and giving its
  place back, a dead one 429 while the failures are spent, the email read in lower case, a device
  named first, a change or a reset of the password, the confirmation of a new email and the factor
  turned off ending the challenge, and a ban between the steps answered 403, judging nothing) and
  `auth-handler/confirm-sign-in-device-limit.spec.ts` (past the limit of devices the last backup
  code, a wrong code and a code of the key answered 409 before they are checked: nothing signed in
  or out, the backup code kept, the challenge ended, the failed sign-ins as they were; the
  confirmation from the password signing in with that backup code, which is then used up, or with
  a new code of the key, signing out the device seen least recently and closing its socket; 429
  still first; a ban between the dialog's confirmation and its code answered 403 with the backup
  code kept and taken once the ban is lifted; a challenge past its ten minutes, or after five wrong
  codes, answered 401 before the limit; within the limit, a tenth device and one signed in already,
  a wrong code counted and the right one forgetting) and
  `auth-handler/confirm-sign-in-races.spec.ts` (each of those changes committed in the account's
  turn before a code step and after it, both orders forced by the turn and by a held query, a ban in the turn before the
  step or committed while its session waits for its admission, a factor turned off, or off and
  started again unconfirmed, while the password step waited to write its challenge, refusing a code
  of the key and a backup code with the challenge ended, and a backup code spent beside a renewal
  of the codes or by two challenges, one after the other);
  `auth-handler/challenge-cookie.spec.ts` (a cookie's value read as set, none for one padded with
  whitespace, a challenge's account by
  its row and none for any other value, whether a challenge takes a code (none past its ten
  minutes, after five codes counted, with a count that is no whole number), the internal requests, a challenge that is not one cookie
  value refused before any call is built, one round trip of a challenge whose signature is
  encoded, and the reclaim of expired challenges: each with its count, a count left alone
  included, no unexpired one and no row of another kind, a bounded number at a time, read through
  the index of the ceremonies' expiry as `EXPLAIN FULL` shows);
  `auth-handler/second-factor-asked.spec.ts` (the challenges password steps left unanswered
  reclaimed once expired at the next step that writes one, no row of another kind, no unexpired
  challenge and none expired under a minute ago touched, and a reset link still read as expired);
  `session-hooks.spec.ts` (which paths write a session waiting);
  `two-factor-adapter.spec.ts` (Better Auth's enable, a code on a challenge without a session and
  a backup code spent once, through the patched adapter); `two-factor.routes.spec.ts` (the
  settings of the second factor over a real Better Auth on an embedded directory: the key, its URI,
  the ten codes and the enrolment an enable answers, a confirmation by a code of the key, a code of
  another key refused, a replaced enrolment answering 409 whatever its code, an enable while on and
  a renewal while off answering 409, the earlier backup codes refused after a renewal, a turning
  off twice alike with its challenges ended, a wrong password counted among the failed sign-ins up
  to the 429, a stub policy's 403 at an enable and at a turning off, each change in the account's
  turn and the state read inside it, and the same Bearer reading its devices after every change);
  `passkey-plugin.spec.ts`; `passkey.routes.spec.ts` (with an authenticator in software against the
  real plugin: the registration's options and their policy, a passkey added and listed with its
  date, from a session two days old too, one whose authenticator did not verify its user or whose
  challenge another account's options made refused with nothing kept, a passkey the directory
  refused to write answering 500 while an answer for another origin stays 400, the list's order, a
  removal, another account's passkey and an unknown one answering 404, an id of another form 400);
  `passkey-registration-races.spec.ts` (a deletion, a ban and a reset committed in the account's
  turn before each registration call and after it, both orders forced by the turn and by a held
  query, and a session ended between the gateway's read and the plugin's, or after the plugin's);
  `auth-handler/passkey-sign-in.spec.ts` (the guest's options and their policy, the guest
  ceremony, a verified passkey whose account could not be read once its session was written
  answering 500 with that session ended, an account whose second factor is on signed in with no code, the email's failed
  sign-ins never keeping it out and forgotten by it, an unverified user, a forged signature and a
  replayed assertion refused, a sign-in whose count or session the directory refused to write
  answering 500, a removed or unknown passkey answering 401, the device checked
  before the challenge is spent, a ban before the turn, in it and at the admission, a removal
  committed before the sign-in's turn and after it, waiting through its admission, and the limit
  of devices: 409 naming the account, a retry confirmed for it signing out the device seen least
  recently and closing its socket, and one confirmed for another account asked again);
  `auth-handler/passkey-ceremonies.spec.ts` (the ceremonies of both kinds left unfinished
  reclaimed once expired at the next options, no row of another kind, no unexpired ceremony and
  none expired under a minute ago touched, and a backlog drained a bounded number at a time);
  `passkey-rows.spec.ts` (the reclaim of expired ceremonies of both kinds and of no other row, read
  through the index of the ceremonies' expiry as `EXPLAIN FULL` shows);
  `auth-handler/verification-ban.spec.ts`, which holds the
  verification of a banned account through the real Better Auth: its gate's refusal with the email
  verified, a ban committed while the insert, the readback or the admission is held answering 403
  with no token and the session ended `banned`, a ban after the admission ending the admitted
  session, an admission that fails (500, the session ended, or left waiting when that ending
  fails too), Better Auth's 5xx and its rejected promise (403 for a banned account, 500 else, never
  a token), and a waiting session neither listed nor ending the device's earlier one, its sockets
  closed only once it is admitted;
  `auth-handler/sign-up.spec.ts`, which holds that a new, a taken and a
  concurrently taken email answer alike and no sooner than the floor, and that every sign-up
  takes one of its address's verification mails, and that a name which breaks the rule of a
  profile's name is refused at once, whatever the email; `auth-handler/email-length.spec.ts`,
  which holds the longest email a body may name; `auth-handler/sign-in.spec.ts`,
  `auth-handler/password-reset.spec.ts`,
  `auth-handler/password-change.spec.ts` and `auth-handler/email-change.spec.ts`, which hold the
  uniform answers and their floors, each limit, the single use, the newest link only, the
  expiry of a reset link and of a confirmation, judged again when a link waited for its account,
  the sessions ended with their sockets closed with 4002, every link ended after a reset, a
  change and a confirmation, a password of no account's length (empty, 9 or 36 characters) refused
  and counted as a wrong one at a sign-in, alike for any email, its origin and email's shape
  checked first, and at a change of the password, of the email and a deletion's request, a sign-in that checked the old
  password beside a reset or a change, or whose email moved to another account meanwhile, or to
  one and away or back again, left with no working session and no other account's start, the
  start a
  sign-in carries while the account's profile or settings are missing, a reset that verifies an
  email and the sign-up link answering verified-before after it, a confirmation that ends the
  reset links, a sign-in
  that names no password answered at once for any email, no sign-in taking a turn, a change of
  the email that waited while a reset ended its
  session making no link, a reset or a change whose last step fails leaving every step undone,
  the notices with their recipient and language, the old address's notice holding no part of the
  new email, and that nothing of an email, a token or a password reaches a log;
  `auth-handler/account-deletion.spec.ts`, which holds the deletion mail to the account's own
  email, the request's limit and its refusals (a wrong password counted as a failed sign-in,
  `last-admin` with no mail), the newest link only, the link spent once, judged again when it
  waited for its account, expired after an hour and ended by a change of the password, the
  sessions ended and the sockets closed with 4001 before the rows go, the organisations left,
  `last-admin` at the press keeping the link and the sessions, an invitation that overtook the
  press included, the notice in the account's language, the email
  free to sign up again, and Better Auth's `/delete-user` out of reach;
  `account-links/reset-links.spec.ts`,
  `account-links/email-changes.spec.ts`, `account-links/account-deletions.spec.ts`,
  `account-links/deletion-token.spec.ts`, `account-mails.spec.ts`, `account-passwords.spec.ts`,
  `account-teardown.spec.ts` (every row of an account removed in one transaction and none of
  another's, its second factor, passkeys and pending challenges included, a second removal changing nothing, a membership refusing it, the addressee),
  `reset-mail.spec.ts`, `profile-emails.spec.ts`, `auth-instance.spec.ts`, `auth-log.spec.ts`,
  `auth-models.spec.ts`, `auth-schema.spec.ts`, `auth-sessions/sessions.spec.ts` (the admissions
  of a sign-in and of a verification against a ban, by a session written live after it or ended by
  it, `admitted` keeping the device's newest session, `gone` for a session ended meanwhile, and a
  waiting session read as none until its admission, a sign-in judged before its session is
  written as its admission counts the devices, a waiting sign-in and a device signed in already
  taking no place, and a banned account's judged banned, the account's platform roles read afresh
  at every read), `platform-roles.spec.ts`,
  `bearer-caller.spec.ts`, `device.routes.spec.ts` (a waiting session's token 401 until its
  admission), `device-sessions.spec.ts` (a session a ban ended read with `banned` as why),
  `identity-by-email.spec.ts`, `password-hash.spec.ts`, `verification-mail.spec.ts`).
- `bun run test:db` (the smoke) checks the stand's mail server, then drives sign-up and the
  verification through the mail in the stand's mailbox, sign-in, the credential limits, the
  uniform sign-up and resend, the verification's refusals, the reset of a password through its
  mail (the uniform request, the link that signs a device out with 4002, the link spent), device
  sessions and every sign-out against a stand.
