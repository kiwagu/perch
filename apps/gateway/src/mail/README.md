# Mail (module `mail`)

## Role in the architecture

How the gateway sends mail: one port, `MailPort.send({ to, subject, text, html })`, and its SMTP
adapter, `SmtpMailer`, on nodemailer, built from the SMTP server's URL and the From address. Its
`verify()` connects and greets the server once and answers `mail:UNREACHABLE` when it does not
answer, so a gateway can refuse to start without a mail server. The server has 10 s to accept a
connection, 10 s to greet and 10 s between answers, where nodemailer would wait minutes. A
failed send answers `mail:SEND_FAILED` by its code; the server's text, which may echo the
address, stays out of it, and the adapter logs nothing. The mails are written here, in the
account's language, from the catalogs of `i18n/` through the translator of
`@workspace/i18n/translator`; their HTML escapes every value it writes. A mail asked in a
language the mails are not written in, or whose link is not an `http:` or `https:` address, is
not written: it answers its code, never a mail in another language or with a link of another
kind.

## Surface

- `MailPort`, `MailMessage`, `MailError`, `MailWriteError` (`mail.port.ts`); `SmtpMailer` and
  its `SmtpTimeouts` (`smtp-mailer.ts`).
- `verificationMail({ to, name, link, locale })` (`verification-mail.ts`): the mail whose link
  verifies an account's email, or `mail:LOCALE_UNSUPPORTED` / `mail:LINK_INVALID`.
- `escapeHtml` (`html.ts`).
- Catalogs `i18n/mail.en.json`, `i18n/mail.es.json`, namespace `mail.*`.
- Fixtures: `Outbox` and `linkToken` (`__fixtures__/outbox.ts`), `smtpSink`
  (`__fixtures__/smtp-sink.ts`, which can also refuse every recipient, or never greet).

## Commands

- `bun run test` in `apps/gateway` runs `html.spec.ts`, `verification-mail.spec.ts`,
  `smtp-mailer.spec.ts` (against an SMTP sink on a loopback port) and the fixtures' own
  `__fixtures__/outbox.spec.ts` and `__fixtures__/smtp-sink.spec.ts`.
- `bun run i18n:check` in `apps/gateway` checks the catalogs' keys against the code.
