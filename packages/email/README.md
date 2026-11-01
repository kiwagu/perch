# Email (`@workspace/email`)

## Role in the architecture

The mails the gateway sends, written once with React Email: a shell every mail shares
(`MailLayout`: the brand line, a card, a rule and a footer of two lines), one template per mail,
whose strings are props taken from the catalogs in the account's language, and one render
boundary. The gateway's mail port sends what a render answers; nothing here sends a mail.

The theme (`mail.theme.ts`) mirrors the web app's light palette as literal sRGB hex: mail clients
resolve neither CSS variables nor `oklch()`. A mail is rendered as minified HTML, never
pretty-printed (the formatter reflows long text, and a client such as Gmail clips a message past
about 100 KB), and as plain text for clients that show no HTML. React escapes every value a
template writes, in text and in attributes.

A mail asked in a language the mails are not written in (`mail:LOCALE_UNSUPPORTED`), or whose link
is not an `http:` or `https:` address (`mail:LINK_INVALID`), is not written. Neither is a render
that lost its link (`mail:LINK_LOST`): a template marks its button as the mail's primary action
(`primaryAction`, the attribute `data-mail-action="primary"`), and the render must hold exactly
one such anchor whose href, as a parser decodes it, is the link exactly as it was given, another
anchor leading to the link (the raw link for clients that strip buttons), and the link in its
text. A template edit that breaks the button fails here instead of mailing a dead button above a
working raw link. A render that fails answers `mail:RENDER_FAILED`. Every error is a fixed
text that names no address, name or link.

## Key exports

- `renderVerificationMail({ to, name, link, locale })`: the mail whose link verifies an account's
  email, `ResultAsync<RenderedMail, MailWriteError>`.
- `RenderedMail` (`{ to, subject, html, text }`, the shape the gateway's mail port sends) and
  `MailWriteError`.
- Inside the package: `MailLayout` (`mail.layout.tsx`), `mailTheme` (`mail.theme.ts`),
  `VerificationMail` (`templates/verification.template.tsx`), the render boundary
  `renderMail(element, link)` (`mail.render.ts`), `primaryAction` (`mail.action.ts`),
  `checkMailInput` (`mail-input.ts`), the HTML reader `anchorsOf` (`html.ts`) and the
  catalogs `src/i18n/mail.en.json`, `src/i18n/mail.es.json` (namespace `mail.*`).

## Commands

- `bun run test`: the verification mail in each language, its escaping, its minified HTML and its
  refusals, and the render boundary's guard against template stand-ins whose button lost or
  changed its link while the raw link stays right, or that drop the raw link or the text's link.
- `bun run i18n:check`: the catalogs' keys against the code.
- `bun run typecheck`, `bun run lint`.
