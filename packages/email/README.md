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

Two templates write every mail. `ActionMail` has one action: a heading, the greeting by the
account's name with what the mail is about, the button, the raw link and notes; the verification
mail, the reset mail (a link to the front's `/reset-password` with its token), the confirmation
of a new email (sent to the new email, a link to `/confirm-email` with its token), the deletion
mail (sent to the account's email, a link to `/delete-account` with its token, saying the account
goes for good with every organisation it is the only member of, that the link works for an hour
and that nothing is deleted without it) and the notice of a changed password (a link to
`/forgot-password`, no token, for an owner who did not change it) are each one. `NoticeMail` only
tells and carries no link: the notice of a changed email, sent to the old address, and the notice
of a deleted account, sent to the email it had, are each one. The first is given no new email, so
it can name no part of it; the second names nothing but the address it goes to, as nothing of the
account is left.

A mail asked in a language the mails are not written in (`mail:LOCALE_UNSUPPORTED`), or whose link
is not an `http:` or `https:` address (`mail:LINK_INVALID`), is not written. Neither is a render
that lost its link (`mail:LINK_LOST`): a template marks its button as the mail's primary action
(`primaryAction`, the attribute `data-mail-action="primary"`), and the render must hold exactly
one such anchor whose href, as a parser decodes it, is the link exactly as it was given, another
anchor leading to the link (the raw link for clients that strip buttons), and the link in its
text. A template edit that breaks the button fails here instead of mailing a dead button above a
working raw link. A notice without a link goes through its own boundary (`renderNotice`), which
refuses a render that holds an anchor or an address in its text (`mail:LINK_FOUND`). A render that
fails answers `mail:RENDER_FAILED`. Every error is a fixed text that names no address, name or
link.

## Key exports

- `renderVerificationMail({ to, name, link, locale })`: the mail whose link verifies an account's
  email, `ResultAsync<RenderedMail, MailWriteError>`.
- `renderResetPasswordMail({ to, name, link, locale })`: the mail whose link sets a new password.
- `renderConfirmEmailMail({ to, name, link, locale })`: the mail to a new email, whose link makes
  it the account's email.
- `renderPasswordChangedNotice({ to, name, link, locale })`: the notice of a changed password,
  its link asking for a new one.
- `renderEmailChangedNotice({ to, name, locale })`: the notice to the old address of a changed
  email, with no link.
- `renderDeleteAccountMail({ to, name, link, locale })`: the mail to an account's email whose
  link opens the page that deletes the account.
- `renderAccountDeletedNotice({ to, name, locale })`: the notice to the email a deleted account
  had, with no link.
- `RenderedMail` (`{ to, subject, html, text }`, the shape the gateway's mail port sends) and
  `MailWriteError`.
- Inside the package: `MailLayout` (`mail.layout.tsx`), `mailTheme` (`mail.theme.ts`),
  `ActionMail` and `NoticeMail` (`templates/`, with their shared styles in
  `templates/mail.styles.ts`), the render boundaries `renderMail(element, link)` and
  `renderBody(element)` (`mail.render.ts`) and `renderNotice(element)` (`notice.render.ts`),
  `primaryAction` (`mail.action.ts`), `checkMailInput` and `checkLocale` (`mail-input.ts`), the
  HTML reader `anchorsOf` (`html.ts`) and the catalogs `src/i18n/mail.en.json`,
  `src/i18n/mail.es.json` (namespace `mail.*`).

## Commands

- `bun run test`: each mail in each language, the verification mail's escaping, the minified
  HTML and the refusals, the render boundary's guard against template stand-ins whose button lost
  or changed its link while the raw link stays right, or that drop the raw link or the text's
  link, and the notice boundary's guard against a stand-in that gained an anchor or an address.
- `bun run i18n:check`: the catalogs' keys against the code.
- `bun run typecheck`, `bun run lint`.
