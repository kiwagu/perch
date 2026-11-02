# Request limits (module `limits`)

## Role in the architecture

The gateway's request limits: how many credential checks, failed sign-ins, mails, attempts at a
link, invitations and organisation creations a client address, an email or an identity may make
in a window, and the 429 a refusal answers. The routes ask before the work is done. It has no `index.ts` yet: it
predates the index rule and is imported file by file.

`RequestLimits` (`request-limits.ts`) keeps fixed windows (`fixed-window.ts`) in the gateway
process's memory, each starting at its key's first attempt; every gateway process keeps its own, so several processes
multiply them. Credential checks, `POST /auth/sign-up/email`, `POST /auth/sign-in/email` and
`POST /auth/verify-email` together (a sign-up and a sign-in are each one argon2 run; a
verification signs a device in as a sign-in does), are limited to 20 per client address in 10 s
by the auth mount in front of Better Auth's handler (`src/auth/auth-handler/`), before anything
else is asked.
Better Auth's own limiter is off (`src/auth/auth-instance.ts`): it restarts its count only after
a pause as long as its window, so it would refuse an address's 21st request however slowly the
20 before it came. Failed sign-ins (answered 401) are limited to 10 per email in 15
minutes, cleared by a successful sign-in, or one Better Auth answers 403 (the password was
right, the email is not verified yet), by the same mount. An email counts in lower case, as
the directory keeps and matches an account's: an address in any case is one account, and its
failures in any case share one limit. A sign-in holds one of its
email's 10 places from the moment it is let through until Better Auth answers, so parallel
guesses are counted while under way: wrong credentials (401) keep the place, a success (200, or 403)
clears the email's window, and any other answer, or a handler that threw instead of answering,
gives the place back; each sign-in is settled once. A sign-in whose body is not JSON naming an
email answers 400 and counts against no email (its address's check, taken first, stays taken, as
every sign-up's does whatever Better Auth answers); one that is reaches Better Auth as that very
JSON, whatever content type it came with, so the email whose password is checked is the email
counted. A
refusal answers 429 `{ "code": "rate-limited" }` with `Retry-After` in whole seconds (at least
1), before the password is checked, and is not logged.
Mails are limited to 200 per client address in 15 minutes (`ADDRESS_MAILS`): sign-ups, resends
of the verification mail, requests for a reset mail and changes of an email together, every
attempt counted whatever the email (`verificationMail(address)` for a sign-up's mail,
`verificationMail(address, email)` for a resend, `resetMail(address, email)` for a reset mail,
`emailChangeMail(address, identity)` for the confirmation of a new email): one client can make at
most 200 such mails go out per quarter hour, where the credential limit alone would let 1,800
sign-ups through. The auth mount charges every
`POST /auth/sign-up/email` before it reads its body, a taken email's and one that names none
included (each new account's sign-up mails its link, and a taken email's must cost the same), and
every `POST /auth/send-verification-email` it reads an email from. A resend also takes one of its email's 3 resends in 15 minutes
(`EMAIL_VERIFICATION_MAILS`, the email in lower case), whatever the email, an unknown or a
verified one too, so the limit tells nothing about accounts. The address is asked first: its place
is reserved, then given back when the email refuses, so a resend the address refuses moves no
email's counter (a client that spent its budget cannot use up another inbox's resends), and one
the email refuses costs the address nothing. A resend takes no credential check; a refusal answers
429 `rate-limited` with `Retry-After`, Better Auth not asked.
The client address (`clientAddress`) is the rightmost `X-Forwarded-For` entry when it is an IPv4
or IPv6 address, else the socket's peer; an IPv6 address counts by its /64. The front must set
`X-Forwarded-For` to the address it saw, as Caddy's `reverse_proxy` does; behind a front that
sets none, every client shares the front's address. Behind a load balancer in front of Caddy,
Caddy sees the balancer and, even when it trusts it, appends the balancer's address last, so
Caddy must name the balancer in its `trusted_proxies` (with `trusted_proxies_strict`) and send
the client's address on with `header_up X-Forwarded-For {client_ip}`, or every client shares the
balancer's buckets.
The gateway listens on `127.0.0.1` only, so nothing but the front and local tools can name an
address (the smoke and the load test give each simulated device one of its own,
`198.18.<a>.<b>` from a hash of its id). Each window table holds at most
100 000 keys, in the order their windows started: an unseen key at a full table evicts the window
that started first, even a live one, and is let in. Availability wins over a marginal gain:
refusing unseen keys would let anyone who fills a table with cheap requests (sign-ins of unknown
emails, addresses from many IPv6 /64s) lock everyone else out, while an evicted key only starts
a fresh window.
A request for a reset mail (`POST /auth/request-password-reset`) also takes one of its email's 3
reset mails in 15 minutes (`EMAIL_RESET_MAILS`, the email in lower case), whatever the email, so
the limit tells nothing about accounts; a change of an email (`POST /auth/change-email`) one of
its account's 3 changes in 15 minutes (`IDENTITY_EMAIL_CHANGES`). Each is reserved after the
address's mail, which is given back when the email's or the account's limit refuses. The
attempts at a link are limited to 20 per client address in 10 minutes (`ADDRESS_LINK_ATTEMPTS`),
the resets of a password (`passwordReset`, `POST /auth/reset-password`) and the confirmations of
a new email (`emailConfirmation`, `POST /auth/confirm-email`) each on their own, every attempt
counted, refused or not, before anything is read: a link's token is too long to guess, so the
limit keeps one client from hammering the directory. A change of a password or of an email takes
one of its address's credential checks, and its current password a place among its account's
failed sign-ins, as a sign-in does.
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
  `FAILED_SIGN_INS`, `ADDRESS_MAILS`, `EMAIL_VERIFICATION_MAILS`, `EMAIL_RESET_MAILS`,
  `IDENTITY_EMAIL_CHANGES`, `ADDRESS_LINK_ATTEMPTS`, `IDENTITY_INVITES`, `ADDRESS_INVITES`,
  `IDENTITY_ORGANISATIONS`, `ADDRESS_ORGANISATIONS`), over `FixedWindow` (`fixed-window.ts`);
  `verificationMail` takes a sign-up's or a resend's mail, `resetMail` a reset mail,
  `emailChangeMail` the confirmation of a new email, `passwordReset` and `emailConfirmation` an
  attempt at a link.
- `clientAddress` (`client-address.ts`) and `addressKey` (`address-key.ts`): the address a
  request counts under.
- `tooMany` (`too-many.ts`): the 429 answer with `Retry-After`.
- Used by the auth mount and the organisation routes; built by the composition root.

## Commands

- `bun run test` in `apps/gateway` runs this module's specs (`request-limits.spec.ts`,
  `fixed-window.spec.ts`, `client-address.spec.ts`, `address-key.spec.ts`,
  `too-many.spec.ts`).
- `bun run test:db` (the smoke) drives the per-address, the failed sign-in and the per-email
  resend limits against a stand.
