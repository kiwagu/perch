# Operators' console (module `console`)

## Role in the architecture

The gateway's console for the platform's operators: the accounts of the platform, found by a part
of their email or name a page at a time, one account's card, and what an operator does to an
account's standing: a ban, the lift of a ban, a sign-out everywhere. Only an operator reaches it:
every request is answered through the Bearer caller of the auth module (a valid device header, a
live session of that device that is no sign-in still waiting for its admission) and then the
operator check (`operatorCaller`, `console-routes/operator-caller.ts`): `operator` must be among the
account's platform roles, which the caller read takes from the session's own answer at every
request (`AuthSessions.read`, `rolesOf`), so a role the host's command takes back refuses the next
request with 403 `not-operator`. Nothing is read for a request the gate refuses. It has no domain
rules of its own, so no `domain/` or `application/` folders; the rest of the server enters it
through `index.ts`.

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

Every action on an account (`console-routes/ban-handlers.ts`) runs in the account's turn
(`GatewayRoot.accountTurns`, by its identity's key), the turn the auth mount's changes of an
account take, so two operators' actions on one account run one after the other and never beside
the account's own change of its password or email or its deletion; the account is read again in
its turn, and one removed meanwhile answers `account-gone`. Its sockets close only once what ended
its sessions committed, still in its turn: 4004 (`CLOSE.banned`) after a ban, 4001
(`CLOSE.revoked`) after a sign-out everywhere, which ends the sessions as the account's own sign-out
everywhere does (`AuthSessions.revokeAll`, `revoked`). A ban and a sign-out of the operator's own
account are refused before its turn is asked for and before anything is written.

The refusals and their statuses (`console-refusal.ts`) follow the organisation routes': a query, a
body or a header that does not follow its schema 400 `bad-request`, an account that is no operator
403 `not-operator`, an account no longer there 404 `account-gone`, an action on the operator's own
account 409 `own-account`; a failure of the gateway answers 500 `internal` without its cause, which
the server logs by its code.

## Surface

- Routes (`console-routes/`, through its `index.ts`: the targets of a path, the operator caller,
  the read handlers, the ban handlers and the routes that answer them), each for an operator alone:
  - `GET /console/accounts?q&page&size`: 200 `{ accounts, total }`, page `page` (from 1, default
    1) of `size` accounts (10, 25 or 50, default 25) whose email or shown name holds `q` (up to 254
    characters; absent or empty, every account), each `{ id, name, email, emailVerified, banned,
    operator, createdAt }`; a page past the last holds none. A query naming another key, a key
    twice or a value out of its schema answers 400 `bad-request`.
  - `GET /console/accounts/:id`: 200 `{ account }`, `{ id, name, email, emailVerified, createdAt,
    hasProfile, lastSeenAt, operator, banned, banReason, organisations }`, `lastSeenAt` and
    `banReason` null when the account has none, `organisations` each `{ key, name, role }`; 404
    `account-gone` for an id no account has, of the form of an identity id or not.
  - `POST /console/accounts/:id/ban` with `{ reason? }` (at most 500 characters once trimmed,
    else 400 `bad-request`): 204 once the account is banned and its sessions ended, then its
    sockets closed with 4004; 409 `own-account` for the operator's own account.
  - `POST /console/accounts/:id/unban`: 204 once the ban is lifted; nothing ends, nothing closes.
  - `POST /console/accounts/:id/sign-out`: 204 once every session of the account ended `revoked`,
    then its sockets closed with 4001; 409 `own-account` for the operator's own account.
  - Each action answers 404 `account-gone` for an id no account has (of the form of an identity
    id or not), or no longer has once its turn came.
  - Before anything else: 400 `bad-request` without a valid device header, 401 `unauthorized`
    (with `WWW-Authenticate: Bearer`) without a live session, 403 `not-operator` without the role;
    then 405 with `Allow` for a method a path does not take.
- Services: `AccountDirectory` (`list`, `read`); `AccountBans` (`ban`, `unban`); the refusal codes
  and their statuses, and the answers to a refusal and to a failure (`console-refusal.ts`).
- Queries: `surql/` (the list with its count, the card, the ban and its lift).
- Built by the composition root, `src/composition/root.ts` (`accountDirectory`, `accountBans`,
  with its `accountTurns`, `sessions` and `connections`); served by `src/server.ts`.

## Commands

- `bun --bun vitest run src/console` in `apps/gateway` runs this module's specs
  (`account-directory.spec.ts`, `account-bans.spec.ts`, `console-routes/operator-caller.spec.ts`,
  `console-routes/routes.spec.ts`, `console-routes/ban-handlers.spec.ts`), each on an embedded
  in-memory directory of its own; `account-bans.spec.ts` also holds the ban's boundary against a
  real sign-in through the auth mount, its admission held while the ban commits and answered
  before it; `bun run test` runs them with the rest. The gateway's smoke (`bun run test:db`)
  bans, lifts and signs out an account with a socket open on a stand.
