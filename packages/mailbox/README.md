# Mailbox (`@workspace/mailbox`)

## Role in the architecture

The suites' way to read the mails the gateway sends on a stand: a client of MailDev's REST API
(`GET /email?to.address=<address>`), which every stand runs as its mailbox (see
`infra/dev/README.md`). It answers the mails to an address, oldest first, waits for the next one
(the gateway does not await its sends), and reads the first link of a mail and the token a
verification link carries. Every look at the mailbox, the request and the reading of its
answer, ends within the time it was given (what is left of `next`'s wait, 10 s for `mails` and
`count`), its request cancelled when it runs out, whatever MailDev does. Its failures say what
went wrong in fixed words, never an address, a subject or a link, and carry no cause, since test
runs print them. The e2e support, the
gateway's smoke and load test, and the seed use it, so each signs up through the real
verification flow. Tooling only, never shipped.

## Key exports

- `Mailbox` (`mails`, `count`, `next`, `verificationToken`), `MailboxFetcher` (`fetch`'s
  shape with the signal that cancels a request: the default is `fetch`, a spec passes a fake).
- `firstLink(mail)`, `linkToken(link)`.
- `mailSchema`, `Mail`.

## Commands

- `bun run test`: the client against a fake MailDev, and the links.
- `bun run typecheck`, `bun run lint`.
