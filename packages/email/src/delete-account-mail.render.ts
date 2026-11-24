import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { ActionMail } from './templates/action.template'

export interface DeleteAccountMailInput {
  /** The account's email, which the mail goes to and names. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The front's screen that deletes the account, with the link's token: an `http:` or `https:` address. */
  readonly link: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The mail to an account's email whose link opens the page that deletes the account, in the
 * account's language, rendered through the render boundary: its subject, minified HTML and plain
 * text. It says that the account goes for good, with every organisation it is the only member of,
 * that the link works for an hour, and that nothing is deleted without it. A language the mails
 * are not written in, a link that is not an http or https address, or a render that lost the link
 * writes no mail: it answers its code, never with the address, the name or the link.
 */
export function renderDeleteAccountMail(
  input: DeleteAccountMailInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(ActionMail, {
      lang: locale,
      preview: t('mail.delete-account.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.delete-account.heading'),
      greeting: t('mail.delete-account.greeting', { name: input.name }),
      body: t('mail.delete-account.body', { email: input.to }),
      action: t('mail.delete-account.action'),
      link: input.link,
      fallback: t('mail.delete-account.fallback'),
      notes: [t('mail.delete-account.expiry'), t('mail.delete-account.ignore')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.delete-account.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.delete-account.subject'),
      ...body,
    }))
  })
}
