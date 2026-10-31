import { err, ok, type Result } from 'neverthrow'

import { createTranslator, type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'

import { escapeHtml } from './html'
import en from './i18n/mail.en.json'
import es from './i18n/mail.es.json'
import type { MailMessage, MailWriteError } from './mail.port'

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

const CATALOGS = { en, es }

/** The schemes a mail's link may have: the front's own pages, never a script or another protocol. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

const LOCALE_UNSUPPORTED: MailWriteError = {
  code: 'mail:LOCALE_UNSUPPORTED',
  message: 'the mail was asked in a language the mails are not written in',
}

const LINK_INVALID: MailWriteError = {
  code: 'mail:LINK_INVALID',
  message: 'the link of the mail is not an http or https address',
}

const supportedLocale = (locale: string): Locale | undefined =>
  SUPPORTED_LOCALES.find((supported) => supported === locale)

const openableLink = (link: string): boolean => {
  const url = URL.parse(link)

  return url !== null && LINK_SCHEMES.has(url.protocol)
}

/**
 * The mail whose link verifies an account's email, in the account's language: the greeting, the
 * link in the text and behind the HTML's button, its lifetime, and what to do with a mail nobody
 * asked for. The HTML escapes everything it writes; the text keeps the name as it was typed. A
 * language the mails are not written in, or a link that is not an http or https address, writes
 * no mail: it answers its code, never a mail in another language or a link of another kind.
 */
export function verificationMail(
  input: VerificationMailInput,
): Result<MailMessage, MailWriteError> {
  const locale = supportedLocale(input.locale)

  if (locale === undefined) {
    return err(LOCALE_UNSUPPORTED)
  }

  if (!openableLink(input.link)) {
    return err(LINK_INVALID)
  }

  const t = createTranslator(CATALOGS, locale)
  const subject = t('mail.verify-email.subject')
  const greeting = t('mail.verify-email.greeting', { name: input.name })
  const body = t('mail.verify-email.body', { email: input.to })
  const action = t('mail.verify-email.action')
  const expiry = t('mail.verify-email.expiry')
  const ignore = t('mail.verify-email.ignore')

  return ok({
    to: input.to,
    subject,
    text: [greeting, body, input.link, expiry, ignore].join('\n\n'),
    html: [
      '<!doctype html>',
      `<html lang="${locale}">`,
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
  })
}
