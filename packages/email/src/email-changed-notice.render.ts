import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import type { RenderedMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkLocale } from './mail-input'
import { renderNotice } from './notice.render'
import { NoticeMail } from './templates/notice.template'

export interface EmailChangedNoticeInput {
  /** The email the account had until it changed, which the notice goes to. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The notice to the email an account had, once the account changed it, in the account's
 * language, rendered through the notice's boundary: its subject, minified HTML and plain text. It
 * is told nothing of the new email, so it can name no part of it, and it carries no link: a render
 * that holds one is refused (`mail:LINK_FOUND`). A language the mails are not written in writes no
 * mail: it answers its code, never with the address or the name.
 */
export function renderEmailChangedNotice(
  input: EmailChangedNoticeInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkLocale(input.locale).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(NoticeMail, {
      lang: locale,
      preview: t('mail.email-changed.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.email-changed.heading'),
      greeting: t('mail.email-changed.greeting', { name: input.name }),
      body: t('mail.email-changed.body', { email: input.to }),
      notes: [t('mail.email-changed.stranger')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.email-changed.reason'),
    })

    return renderNotice(element).map((body) => ({
      to: input.to,
      subject: t('mail.email-changed.subject'),
      ...body,
    }))
  })
}
