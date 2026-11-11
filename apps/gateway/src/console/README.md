# Operators' console (module `console`)

## Role in the architecture

The gateway's console for the platform's operators: the accounts of the platform, found by a part
of their email or name a page at a time, and one account's card. Only an operator reaches it: every
request is answered through the Bearer caller of the auth module (a valid device header, a live
session of that device that is no sign-in still waiting for its admission) and then the operator
check (`operatorCaller`, `console-routes/operator-caller.ts`): `operator` must be among the
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

The refusals and their statuses (`console-refusal.ts`) follow the organisation routes': a query or
a header that does not follow its schema 400 `bad-request`, an account that is no operator 403
`not-operator`, an account no longer there 404 `account-gone`; a failure of the gateway answers 500
`internal` without its cause, which the server logs by its code.

## Surface

- Routes (`console-routes/`, through its `index.ts`: the targets of a path, the operator caller,
  the read handlers and the routes that answer them), each for an operator alone:
  - `GET /console/accounts?q&page&size`: 200 `{ accounts, total }`, page `page` (from 1, default
    1) of `size` accounts (10, 25 or 50, default 25) whose email or shown name holds `q` (up to 254
    characters; absent or empty, every account), each `{ id, name, email, emailVerified, banned,
    operator, createdAt }`; a page past the last holds none. A query naming another key, a key
    twice or a value out of its schema answers 400 `bad-request`.
  - `GET /console/accounts/:id`: 200 `{ account }`, `{ id, name, email, emailVerified, createdAt,
    hasProfile, lastSeenAt, operator, banned, banReason, organisations }`, `lastSeenAt` and
    `banReason` null when the account has none, `organisations` each `{ key, name, role }`; 404
    `account-gone` for an id no account has, of the form of an identity id or not.
  - Before anything else: 400 `bad-request` without a valid device header, 401 `unauthorized`
    (with `WWW-Authenticate: Bearer`) without a live session, 403 `not-operator` without the role;
    then 405 with `Allow` for a method a path does not take.
- Services: `AccountDirectory` (`list`, `read`); the refusal codes and their statuses, and the
  answers to a refusal and to a failure (`console-refusal.ts`).
- Queries: `surql/` (the list with its count, the card).
- Built by the composition root, `src/composition/root.ts` (`accountDirectory`); served by
  `src/server.ts`.

## Commands

- `bun --bun vitest run src/console` in `apps/gateway` runs this module's specs
  (`account-directory.spec.ts`, `console-routes/operator-caller.spec.ts`,
  `console-routes/routes.spec.ts`), each on an embedded in-memory directory of its own;
  `bun run test` runs them with the rest.
