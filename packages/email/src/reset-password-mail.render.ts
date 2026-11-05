import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { ActionMail } from './templates/action.template'

export interface ResetPasswordMailInput {
  /** The account's email, which the mail goes to and names. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The front's screen that sets a new password, with the link's token: an `http:` or `https:` address. */
  readonly link: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The mail whose link sets a new password for an account, in the account's language, rendered
 * through the render boundary: its subject, minified HTML and plain text. A language the mails are
 * not written in, a link that is not an http or https address, or a render that lost the link
 * writes no mail: it answers its code, never with the address, the name or the link.
 */
export function renderResetPasswordMail(
  input: ResetPasswordMailInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(ActionMail, {
      lang: locale,
      preview: t('mail.reset-password.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.reset-password.heading'),
      greeting: t('mail.reset-password.greeting', { name: input.name }),
      body: t('mail.reset-password.body', { email: input.to }),
      action: t('mail.reset-password.action'),
      link: input.link,
      fallback: t('mail.reset-password.fallback'),
      notes: [t('mail.reset-password.expiry'), t('mail.reset-password.ignore')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.reset-password.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.reset-password.subject'),
      ...body,
    }))
  })
}
