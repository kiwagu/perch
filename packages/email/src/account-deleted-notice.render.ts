import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import type { RenderedMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkLocale } from './mail-input'
import { renderNotice } from './notice.render'
import { NoticeMail } from './templates/notice.template'

export interface AccountDeletedNoticeInput {
  /** The email the deleted account had, which the notice goes to. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /**
   * The account's language as it was read before the account went: one of `SUPPORTED_LOCALES`, or
   * no mail is written.
   */
  readonly locale: string
}

/**
 * The notice to the email a deleted account had, in the account's language, rendered through the
 * notice's boundary: its subject, minified HTML and plain text. It says the account was deleted
 * and names nothing else of it, and it carries no link, since nothing is left to act on: a render
 * that holds one is refused (`mail:LINK_FOUND`). A language the mails are not written in writes no
 * mail: it answers its code, never with the address or the name.
 */
export function renderAccountDeletedNotice(
  input: AccountDeletedNoticeInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkLocale(input.locale).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(NoticeMail, {
      lang: locale,
      preview: t('mail.account-deleted.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.account-deleted.heading'),
      greeting: t('mail.account-deleted.greeting', { name: input.name }),
      body: t('mail.account-deleted.body', { email: input.to }),
      notes: [t('mail.account-deleted.again'), t('mail.account-deleted.stranger')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.account-deleted.reason'),
    })

    return renderNotice(element).map((body) => ({
      to: input.to,
      subject: t('mail.account-deleted.subject'),
      ...body,
    }))
  })
}
