# Mail (module `mail`)

## Role in the architecture

How the gateway sends mail: one port, `MailPort.send({ to, subject, text, html })`, and its SMTP
adapter, `SmtpMailer`, on nodemailer, built by `SmtpMailer.create` from the SMTP server's URL and
the From address. nodemailer reads the URL at once and refuses a host it cannot use with an error
that carries the whole URL, the server's password with it: `create` answers `mail:URL_INVALID` with
fixed words instead, keeping nothing of that error. Its `verify()` connects and greets the server
once and answers `mail:UNREACHABLE` when it does not answer, so a gateway can refuse to start
without a mail server. The server has 10 s to accept a connection, 10 s to greet and 10 s between
answers, where nodemailer would wait minutes. A failed send answers `mail:SEND_FAILED` by its code;
the server's text, which may echo the address, stays out of it, and the adapter logs nothing. The
mails are not written here: `@workspace/email` renders them (React Email: a shared layout, a
template per mail, catalogs in each language) into the `{ to, subject, text, html }` the port
sends, and its callers (the auth module's verification mailer) hand that to `send`.

## Surface

- `MailPort`, `MailMessage`, `MailError`, `MailSetupError` (`mail.port.ts`); `SmtpMailer`, its
  `create` and its `SmtpTimeouts` (`smtp-mailer.ts`).
- Fixtures: `Outbox` and `linkToken` (`__fixtures__/outbox.ts`), `smtpSink`
  (`__fixtures__/smtp-sink.ts`, which can also refuse every recipient, or never greet).

## Commands

- `bun run test` in `apps/gateway` runs `smtp-mailer.spec.ts` (against an SMTP sink on a loopback
  port) and the fixtures' own `__fixtures__/outbox.spec.ts` and `__fixtures__/smtp-sink.spec.ts`.
