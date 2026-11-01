import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { ActionMail } from './templates/action.template'

export interface PasswordChangedNoticeInput {
  /** The account's email, which the notice goes to. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /**
   * The front's screen that asks for a new password, for an owner who did not change it: an
   * `http:` or `https:` address with no token.
   */
  readonly link: string
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The notice that an account's password was changed, in the account's language, rendered through
 * the render boundary: its subject, minified HTML and plain text. Its one link asks for a new
 * password, for an owner who did not change it; it carries no token. A language the mails are not
 * written in, a link that is not an http or https address, or a render that lost the link writes
 * no mail: it answers its code, never with the address, the name or the link.
 */
export function renderPasswordChangedNotice(
  input: PasswordChangedNoticeInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(ActionMail, {
      lang: locale,
      preview: t('mail.password-changed.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.password-changed.heading'),
      greeting: t('mail.password-changed.greeting', { name: input.name }),
      body: t('mail.password-changed.body', { email: input.to }),
      action: t('mail.password-changed.action'),
      link: input.link,
      fallback: t('mail.password-changed.fallback'),
      notes: [t('mail.password-changed.done')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.password-changed.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.password-changed.subject'),
      ...body,
    }))
  })
}
