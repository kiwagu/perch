import { createTranslator, type Locale } from '@workspace/i18n/translator'

import { escapeHtml } from './html'
import en from './i18n/mail.en.json'
import es from './i18n/mail.es.json'
import type { MailMessage } from './mail.port'

export interface VerificationMailInput {
  /** The account's email, which the mail goes to and names. */
  readonly to: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The front's screen that verifies the email, with the link's token. */
  readonly link: string
  readonly locale: Locale
}

const CATALOGS = { en, es }

/**
 * The mail whose link verifies an account's email, in the account's language: the greeting, the
 * link in the text and behind the HTML's button, its lifetime, and what to do with a mail nobody
 * asked for. The HTML escapes everything it writes; the text keeps the name as it was typed.
 */
export function verificationMail(input: VerificationMailInput): MailMessage {
  const t = createTranslator(CATALOGS, input.locale)
  const subject = t('mail.verify-email.subject')
  const greeting = t('mail.verify-email.greeting', { name: input.name })
  const body = t('mail.verify-email.body', { email: input.to })
  const action = t('mail.verify-email.action')
  const expiry = t('mail.verify-email.expiry')
  const ignore = t('mail.verify-email.ignore')

  return {
    to: input.to,
    subject,
    text: [greeting, body, input.link, expiry, ignore].join('\n\n'),
    html: [
      '<!doctype html>',
      `<html lang="${input.locale}">`,
      `<head><meta charset="utf-8"><title>${escapeHtml(subject)}</title></head>`,
      '<body>',
      `<p>${escapeHtml(greeting)}</p>`,
      `<p>${escapeHtml(body)}</p>`,
      `<p><a href="${escapeHtml(input.link)}">${escapeHtml(action)}</a></p>`,
      `<p>${escapeHtml(expiry)}</p>`,
      `<p>${escapeHtml(ignore)}</p>`,
      '</body>',
      '</html>',
    ].join('\n'),
  }
}
