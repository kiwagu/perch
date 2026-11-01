import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { VerificationMail } from './templates/verification.template'

export interface VerificationMailInput {
  /** The account's email, which the mail goes to and names. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The front's screen that verifies the email, with the link's token: an `http:` or `https:` address. */
  readonly link: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The mail whose link verifies an account's email, in the account's language, rendered through
 * the render boundary: its subject, minified HTML and plain text. A language the mails are not
 * written in, a link that is not an http or https address, or a render that lost the link writes
 * no mail: it answers its code, never with the address, the name or the link.
 */
export function renderVerificationMail(
  input: VerificationMailInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(VerificationMail, {
      lang: locale,
      preview: t('mail.verify-email.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.verify-email.heading'),
      greeting: t('mail.verify-email.greeting', { name: input.name }),
      body: t('mail.verify-email.body', { email: input.to }),
      action: t('mail.verify-email.action'),
      link: input.link,
      fallback: t('mail.verify-email.fallback'),
      expiry: t('mail.verify-email.expiry'),
      ignore: t('mail.verify-email.ignore'),
      tagline: t('mail.layout.tagline'),
      reason: t('mail.verify-email.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.verify-email.subject'),
      ...body,
    }))
  })
}
