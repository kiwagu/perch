import type { ResultAsync } from 'neverthrow'
import { createElement } from 'react'

import type { MailWriteError } from './mail.error'
import { type RenderedMail, renderMail } from './mail.render'
import { mailTranslator } from './mail.translator'
import { checkMailInput } from './mail-input'
import { ActionMail } from './templates/action.template'

export interface InvitationMailInput {
  /** The email the invitation is for, which the mail goes to; it may have no account. */
  readonly to: string
  /** The name of the organisation the invitation is to, as its admins gave it. */
  readonly organisation: string
  /** The role the account takes when it accepts. */
  readonly role: 'member' | 'admin'
  /** The front's screen that shows the invitation, with the link's token: an `http:` or `https:` address. */
  readonly link: string
  /** The recipient's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
}

/**
 * The mail to an invited email whose link opens the screen that shows the invitation, in the
 * recipient's language, rendered through the render boundary: its subject, minified HTML and plain
 * text. The recipient may have no account, so it greets no one by name, and it names no inviter:
 * it names the organisation and the role (as the catalogs word them), says the link works once and
 * for seven days, and that nothing happens without the link. The subject names no organisation,
 * whose name anyone who can create one chooses. A language the mails are not written in, a link
 * that is not an http or https address, or a render that lost the link writes no mail: it answers
 * its code, never with the address, the organisation or the link.
 */
export function renderInvitationMail(
  input: InvitationMailInput,
): ResultAsync<RenderedMail, MailWriteError> {
  return checkMailInput(input).asyncAndThen((locale) => {
    const t = mailTranslator(locale)
    const element = createElement(ActionMail, {
      lang: locale,
      preview: t('mail.invitation.preview'),
      brand: t('mail.layout.brand'),
      heading: t('mail.invitation.heading'),
      greeting: t('mail.invitation.greeting'),
      body: t('mail.invitation.body', {
        organisation: input.organisation,
        role: t(
          input.role === 'admin' ? 'mail.invitation.role.admin' : 'mail.invitation.role.member',
        ),
      }),
      action: t('mail.invitation.action'),
      link: input.link,
      fallback: t('mail.invitation.fallback'),
      notes: [t('mail.invitation.expiry'), t('mail.invitation.ignore')],
      tagline: t('mail.layout.tagline'),
      reason: t('mail.invitation.reason'),
    })

    return renderMail(element, input.link).map((body) => ({
      to: input.to,
      subject: t('mail.invitation.subject'),
      ...body,
    }))
  })
}
