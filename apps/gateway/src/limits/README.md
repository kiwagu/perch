# Request limits (module `limits`)

## Role in the architecture

The gateway's request limits: how many credential checks, failed sign-ins, renewals,
invitations and organisation creations a client address, an email, a device or an identity
may make in a window, and the 429 a refusal answers. The routes and the hello ask before the
database is asked. It has no `index.ts` yet: it predates the index rule and is imported file
by file.

`RequestLimits` (`request-limits.ts`) keeps fixed windows (`fixed-window.ts`) in the gateway
process's memory, each starting at its key's first attempt; every gateway process keeps its own, so several processes
multiply them. Credential checks, `POST /auth/sign-up` and `POST /auth/sign-in` together (each
one argon2 run on the database), are limited to 20 per client address in 10 s; failed sign-ins
(answered `invalid-credentials`) to 10 per email in 15 minutes, cleared by a successful
sign-in. An email counts in lower case, as the routes take it and the directory keeps and
matches an account's (`src/auth/account-email.ts`): an address in any case is one account, and its
failures in any case share one limit. A sign-in holds one of its
email's 10 places from the moment it is let through until the database answers, so parallel
guesses are counted while under way: wrong credentials keep the place, a success clears the
email's window, and an answer the database could not judge, or a call that threw instead of
answering, gives the place back; each sign-in is settled once. A body that fails its schema
(400) counts nothing. A refusal answers 429 `{ "code": "rate-limited" }` with `Retry-After` in
whole seconds (at least 1), before the database is asked, and is not logged.
The client address is the rightmost `X-Forwarded-For` entry when it is an IPv4 or IPv6 address,
else the socket's peer; an IPv6 address counts by its /64. The front must set `X-Forwarded-For`
to the address it saw, as Caddy's `reverse_proxy` does; behind a front that sets none, every
client shares the front's address. Behind a load balancer in front of Caddy, Caddy sees the
balancer and, even when it trusts it, appends the balancer's address last, so Caddy must name the
balancer in its `trusted_proxies` (with `trusted_proxies_strict`) and send the client's address
on with `header_up X-Forwarded-For {client_ip}`, or every client shares the balancer's buckets.
The gateway listens on `127.0.0.1` only, so nothing but the front and local tools can name an
address (the smoke and the load test give each simulated device one of its own,
`198.18.<a>.<b>` from a hash of its id). Each window table holds at most
100 000 keys, in the order their windows started: an unseen key at a full table evicts the window
that started first, even a live one, and is let in. Availability wins over a marginal gain:
refusing unseen keys would let anyone who fills a table with cheap requests (sign-ins of unknown
emails, addresses from many IPv6 /64s) lock everyone else out, while an evicted key only starts
a fresh window.
Refresh-key renewals, at hello and inside `POST /auth/sign-out`, are limited to 10 per device (the
id the hello or `X-Perch-Device` names) in 15 minutes and to 120 per client address in a minute,
the address charged only when the device's limit allows, and a renewal the address refuses gives
the device's attempt back (once, while the device's window still holds it): behind one address
whose devices all renew at once, as after a night when every access token expired, the devices the
address holds back retry with their reconnect backoff without spending their own limit, so 500 of
them all renew within about four minutes instead of being held for 15 minutes. A renewal is counted
when the database refused the access token and a refresh key came with it, before the key is
exchanged, so a refused one asks the database nothing and spends nothing (`data:RATE_LIMITED`); a
working access token counts nothing, and neither does one the database could not judge, which fails
as it is (a hello closes as a failed server, the pair sign-out answers 500). A hello's address is
the one its upgrade request came from. A hello whose renewal is refused is closed with 1013 (`too
many renewals`, try again later): the client ends its channel only on 4000, 4001, 4400 and 4401, so
it reconnects with its backoff and keeps its keys. The pair sign-out answers 429 `rate-limited`
with `Retry-After`, revoking nothing. `POST /auth/sign-out` itself is not limited, only the renewal
it may run.
Invitations, `POST /organisations/:key/members`, are limited to 30 attempts per inviting identity
and 60 per client address in 10 minutes, so probing which emails have an account stays slow; the
identity is charged first and the address only when the identity's limit allows. Every attempt
counts whatever the answer (an unknown email's 404 included), once the body follows its schema
(a 400 counts nothing); the limit is checked before the service is asked. Organisation creation,
`POST /organisations`, is limited to 10 per identity and 30 per client address in an hour (each
one provisions a database, and one address cannot farm identities past the identity's limit),
the address charged only when the identity's limit allows, checked before anything is
provisioned. A refusal answers 429 `rate-limited` with `Retry-After` and is not logged.

## Surface

- `RequestLimits` (`request-limits.ts`) with the windows it keeps (`CREDENTIAL_CHECKS`,
  `FAILED_SIGN_INS`, `DEVICE_RENEWALS`, `ADDRESS_RENEWALS`, `IDENTITY_INVITES`,
  `ADDRESS_INVITES`, `IDENTITY_ORGANISATIONS`, `ADDRESS_ORGANISATIONS`), over `FixedWindow`
  (`fixed-window.ts`).
- `clientAddress` (`client-address.ts`) and `addressKey` (`address-key.ts`): the address a
  request counts under.
- `tooMany` (`too-many.ts`): the 429 answer with `Retry-After`.
- Used by the auth and organisation routes and by the sync hello; built by the composition
  root.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`request-limits.spec.ts`,
  `fixed-window.spec.ts`, `client-address.spec.ts`, `address-key.spec.ts`,
  `too-many.spec.ts`).
- `bun run test:db` (the smoke) drives the credential and renewal limits against a stand.
