# Operators' console (module `console`)

## Role in the architecture

The gateway's console for the platform's operators: the accounts of the platform, found by a part
of their email or name a page at a time, one account's card, and what an operator does to an
account: its name, its email, a ban, the lift of a ban, a sign-out everywhere, its reset and
verification mails, its removal. Only an operator reaches it: every request is answered through
the Bearer caller of the auth module (a valid device header, a live session of that device that
is no sign-in still waiting for its admission) and then the operator check (`operatorCaller`,
`console-routes/operator-caller.ts`): `operator` must be among the account's platform roles, which
the caller read takes from the session's own answer at every request (`AuthSessions.read`,
`rolesOf`), so a role the host's command takes back refuses the next request with 403
`not-operator`. Nothing is read for a request the gate refuses. It has no domain rules of its own,
so no `domain/` or `application/` folders; the rest of the server enters it through `index.ts`.

`AccountDirectory` (`account-directory.ts`) reads the directory as the namespace user and writes
nothing. Its list (`surql/accounts-list.surql`) keeps the accounts whose email or shown name holds
the search in any case, the shown name being the profile's name or, for an account that has no
profile yet (it never signed in), the name it signed up with; it orders them newest first, two
made at the same instant by their id, so a page holds the same accounts every time it is read, and
answers one page with the number of them all from one transaction, so the two always agree. Each
identity meets its profile by one grouping of the rows of both tables: a subquery per identity
would scan every profile for each identity, the planner taking no index for a value of the outer
row. The list is a scan of both tables: no index serves a search for a part of a text. A list
answers no ban's reason, no password and no token. The card (`surql/account-read.surql`) is the
account by its identity: its email, whether it is verified, when it was made, whether it has a
profile, its shown name, when one of its devices was last seen among its session rows still kept
(ended ones included, a sign-in still waiting for its admission not; none for an account never
signed in), its operator mark, whether it is banned and the reason given, and its organisations
(ready ones, by key) with its role in each; each of its reads takes an index.

`AccountBans` (`account-bans.ts`) writes the ban, each in one transaction of the directory. A ban
(`surql/account-ban.surql`) marks the account banned with the reason given, trimmed (none when
nothing is left), with no lapse, and ends every session of it not ended already in the same
transaction: live ones, a sign-in or a verification still waiting for its admission, an expired one
(at its expiry), each with `banned` as its reason. So no session of a banned account stays usable
once the ban committed: an admission reads the ban in its own transaction, whichever commits
second sees the other, and refuses the account (`auth/README.md`); a failure of any write leaves
none of them done. An account banned already keeps its ban with the reason given now. A lift
(`surql/account-unban.surql`) clears the mark, the reason and the lapse, and ends nothing: the
devices the ban signed out stay signed out. Both answer `gone`, changing nothing, for an identity
no account has.

`ProfileNames` (`profile-names.ts`) writes the name an operator gives an account into its profile,
the name people see, as a change of the server's own in the identity's private region through the
region hub (`writeRecord`): logged, projected into the directory and sent to every subscribed
device of the account like a batch of its own, so its devices show it as any change of the
profile, and one that was offline gets it at its next pull. The profile is found by its identity
(`surql/profile-of.surql`, by the profile's index on its identity), under any id; an account that
has no profile yet (it never signed in) gets nothing written (`no-profile`).

Every action on an account (`console-routes/`) runs in the account's turn
(`GatewayRoot.accountTurns`, by its identity's key, `inAccountTurn`), the turn the auth mount's
changes of an account take, so two operators' actions on one account run one after the other and
never beside the account's own change of its password or email or its deletion; the account is
read again in its turn, and one removed meanwhile answers `account-gone`. An action that needs the
account's email takes the email's turn inside the identity's, as the mount's confirmation of a new
email does, never the other way round, so the two never wait on each other in a circle.

- A rename (`edit-handlers.ts`) holds the name to the profile page's rule (trimmed, 1 to 80
  characters) and writes it through `ProfileNames`; an account without a profile answers 409
  `failed` (the card offers no rename then, so only a race meets it).
- A change of the email (`edit-handlers.ts`) is the account's own change of its email without its
  password (`auth/README.md`): one of the operator's address's mails and one of the account's
  three changes in a quarter of an hour; in the account's turn, an email another account holds,
  or the account's own, answers 409 `email-taken`, nothing changed and nothing sent; any other
  ends the account's pending change, its own or an operator's, keeps the new one and mails its
  link to the new email. The link's confirmation, in the auth mount, moves the email, marks it
  verified (so an account that never verified its own signs in with the new one, and its first
  sign-in starts it) and tells the old email.
- A reset mail and a verification mail (`mail-handlers.ts`) are the mails the account could ask
  for itself, under its own allowances and one of the operator's address's mails. The reset mail's
  allowance is taken in the account's turn for the email the account has there, the email the
  mail goes to: a change of the email confirmed meanwhile takes the same turn, so it lands wholly
  before that read or after the mail, and the old email never pays for a mail to the new one. The
  mail is then asked of Better Auth in the email's turn, as the account's own request asks it
  (`AccountPasswords.requestReset`). An account whose email is verified gets no verification
  mail (409 `verified-before`); otherwise Better Auth is asked to send it again with the email
  alone and no header of the operator's request, so it sees no session and runs its path for a
  visitor, as the auth mount's resend asks it.
- A removal (`removal-handler.ts`) is the account's own deletion without the mailed link: it
  leaves its organisations in their turns (`Organisations.leaveAll`, through the departure),
  whose check refuses the only admin of an organisation with other members (409 `last-admin`,
  nothing changed); once the departure is allowed, and before it writes anything, whom the notice
  goes to is read, every session of the account ends and its sockets close with 4001; then it
  leaves its organisations (one it alone belongs to goes with it), its own rows are removed
  (`AccountTeardown.remove`) and its sockets close with 4001 once more; once it is gone the notice
  starts to the email it had. One that failed part way is completed by asking for it again.
- A ban and a sign-out everywhere (`ban-handlers.ts`) close the account's sockets only once what
  ended its sessions committed, still in its turn: 4004 (`CLOSE.banned`) after a ban, 4001
  (`CLOSE.revoked`) after a sign-out everywhere, which ends the sessions as the account's own
  sign-out everywhere does (`AuthSessions.revokeAll`, `revoked`).

A ban, a sign-out and a removal of the operator's own account are refused before its turn is asked
for and before anything is written.

The refusals and their statuses (`console-refusal.ts`) follow the organisation routes': a query, a
body or a header that does not follow its schema 400 `bad-request`, a name or an email that breaks
its rule 400 (`name-required`, `name-too-long`, `email-invalid`), an account that is no operator
403 `not-operator`, an account no longer there 404 `account-gone`, an action the account's state
refuses 409 (`own-account`, `last-admin`, `email-taken`, `verified-before`, `failed`), a mail past
its allowance 429 `rate-limited` with `Retry-After`; a failure of the gateway answers 500
`internal` without its cause, which the server logs by its code.

## Surface

- Routes (`console-routes/`, through its `index.ts`: the targets of a path, the operator caller,
  the action's account and its turn, the read, edit, ban, mail and removal handlers and the routes
  that answer them), each for an operator alone:
  - `GET /console/accounts?q&page&size`: 200 `{ accounts, total }`, page `page` (from 1, default
    1) of `size` accounts (10, 25 or 50, default 25) whose email or shown name holds `q` (up to 254
    characters; absent or empty, every account), each `{ id, name, email, emailVerified, banned,
    operator, createdAt }`; a page past the last holds none. A query naming another key, a key
    twice or a value out of its schema answers 400 `bad-request`.
  - `GET /console/accounts/:id`: 200 `{ account }`, `{ id, name, email, emailVerified, createdAt,
    hasProfile, lastSeenAt, operator, banned, banReason, organisations }`, `lastSeenAt` and
    `banReason` null when the account has none, `organisations` each `{ key, name, role }`; 404
    `account-gone` for an id no account has, of the form of an identity id or not.
  - `POST /console/accounts/:id/rename` with `{ name }`: 204 once the profile carries the name,
    trimmed; 400 `name-required` (nothing left once trimmed) or `name-too-long` (past 80
    characters), 409 `failed` for an account that has no profile yet.
  - `POST /console/accounts/:id/email` with `{ email }`: 204 once the mail with the change's link
    is on its way to the new email (in lower case, trimmed); 400 `email-invalid` (no email, or past
    320 characters, before any allowance is taken), 409 `email-taken` (another account's email or
    the account's own), 429 `rate-limited` past the account's three changes in a quarter of an hour.
  - `POST /console/accounts/:id/ban` with `{ reason? }` (at most 500 characters once trimmed,
    else 400 `bad-request`): 204 once the account is banned and its sessions ended, then its
    sockets closed with 4004; 409 `own-account` for the operator's own account.
  - `POST /console/accounts/:id/unban`: 204 once the ban is lifted; nothing ends, nothing closes.
  - `POST /console/accounts/:id/sign-out`: 204 once every session of the account ended `revoked`,
    then its sockets closed with 4001; 409 `own-account` for the operator's own account.
  - `POST /console/accounts/:id/reset`: 204 once the reset mail is on its way to the account's
    email; 429 `rate-limited` past that email's three in a quarter of an hour.
  - `POST /console/accounts/:id/verification`: 204 once the verification mail is on its way to the
    account's email; 409 `verified-before` for a verified email, 429 `rate-limited` past that
    email's three in a quarter of an hour.
  - `POST /console/accounts/:id/removal`: 204 once the account is gone, its sockets closed with
    4001 before and after its rows went, the notice on its way to the email it had; 409
    `last-admin` for the only admin of an organisation with other members, `own-account` for the
    operator's own account.
  - Each action answers 404 `account-gone` for an id no account has (of the form of an identity
    id or not), or no longer has once its turn came; a body that does not follow its schema 400
    `bad-request`. A mail counts against the operator's address's mails as well.
  - Before anything else: 400 `bad-request` without a valid device header, 401 `unauthorized`
    (with `WWW-Authenticate: Bearer`) without a live session, 403 `not-operator` without the role;
    then 405 with `Allow` for a method a path does not take.
- Services: `AccountDirectory` (`list`, `read`); `AccountBans` (`ban`, `unban`); `ProfileNames`
  (`rename`); the refusal codes and their statuses, and the answers to a refusal, to a mail past
  its allowance and to a failure (`console-refusal.ts`).
- Queries: `surql/` (the list with its count, the card, the ban and its lift, the profile of an
  identity).
- Built by the composition root, `src/composition/root.ts` (`accountDirectory`, `accountBans`,
  `profileNames`, with its `accountTurns`, `sessions`, `emailChanges`, `passwords`, `auth`,
  `mails`, `limits`, `departure`, `teardown` and `connections`); served by `src/server.ts`.

## Commands

- `bun --bun vitest run src/console` in `apps/gateway` runs this module's specs
  (`account-directory.spec.ts`, `account-bans.spec.ts`, `profile-names.spec.ts`,
  `console-routes/operator-caller.spec.ts`, `console-routes/routes.spec.ts`,
  `console-routes/ban-handlers.spec.ts`, `console-routes/edit-handlers.spec.ts`,
  `console-routes/mail-handlers.spec.ts`, `console-routes/removal-handler.spec.ts`), each on an
  embedded in-memory directory of its own; `account-bans.spec.ts` also holds the ban's boundary
  against a real sign-in through the auth mount, its admission held while the ban commits and
  answered before it, and the edit, mail and removal specs serve the console beside the auth mount
  over one directory, its turns and its limits, so an operator's action meets the account's own
  confirmation, reset and deletion as in the gateway; `bun run test` runs them with the rest. The
  gateway's smoke (`bun run test:db`) bans, lifts and signs out an account with a socket open on a
  stand.
