# Mail (module `mail`)

## Role in the architecture

How the gateway sends mail: one port, `MailPort.send({ to, subject, text, html })`, and its SMTP
adapter, `SmtpMailer`, on nodemailer, built from the SMTP server's URL and the From address. Its
`verify()` connects and greets the server once and answers `mail:UNREACHABLE` when it does not
answer, so a gateway can refuse to start without a mail server. A failed send answers
`mail:SEND_FAILED` by its code; the server's text, which may echo the address, stays out of it,
and the adapter logs nothing. The mails are written here, in the account's language, from the
catalogs of `i18n/` through the translator of `@workspace/i18n/translator`; their HTML escapes
every value it writes.

## Surface

- `MailPort`, `MailMessage`, `MailError` (`mail.port.ts`); `SmtpMailer` (`smtp-mailer.ts`).
- `verificationMail({ to, name, link, locale })` (`verification-mail.ts`): the mail whose link
  verifies an account's email.
- `escapeHtml` (`html.ts`).
- Catalogs `i18n/mail.en.json`, `i18n/mail.es.json`, namespace `mail.*`.
- Fixtures: `Outbox` and `linkToken` (`__fixtures__/outbox.ts`), `smtpSink` (`__fixtures__/smtp-sink.ts`,
  which can also refuse every recipient).

## Commands

- `bun run test` in `apps/gateway` runs `html.spec.ts`, `verification-mail.spec.ts` and
  `smtp-mailer.spec.ts` (against an SMTP sink on a loopback port).
- `bun run i18n:check` in `apps/gateway` checks the catalogs' keys against the code.
