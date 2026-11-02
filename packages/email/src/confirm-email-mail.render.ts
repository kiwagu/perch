import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { ActionMail } from './templates/action.template'

export interface ConfirmEmailMailInput {
  /** The new email the account asked for, which the mail goes to and names. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The front's screen that changes the email, with the link's token: an `http:` or `https:` address. */
  readonly link: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The mail to the new email an account asked for, whose link makes it the account's email, in the
 * account's language, rendered through the render boundary: its subject, minified HTML and plain
 * text. A language the mails are not written in, a link that is not an http or https address, or
 * a render that lost the link writes no mail: it answers its code, never with the address, the
 * name or the link.
 */
export function renderConfirmEmailMail(
  input: ConfirmEmailMailInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(ActionMail, {
      lang: locale,
      preview: t('mail.confirm-email.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.confirm-email.heading'),
      greeting: t('mail.confirm-email.greeting', { name: input.name }),
      body: t('mail.confirm-email.body', { email: input.to }),
      action: t('mail.confirm-email.action'),
      link: input.link,
      fallback: t('mail.confirm-email.fallback'),
      notes: [t('mail.confirm-email.expiry'), t('mail.confirm-email.ignore')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.confirm-email.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.confirm-email.subject'),
      ...body,
    }))
  })
}
