import { err, ok, type Result } from 'neverthrow'

import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'

import { LINK_INVALID, LOCALE_UNSUPPORTED, type MailWriteError } from './mail.error'

/** The schemes a mail's link may have: the front's own pages, never a script or another protocol. */
const LINK_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:'])

/** What a mail with a link is asked in and leads to, before it is written. */
export interface MailInput {
  /** The account's language as it was read: one of `SUPPORTED_LOCALES`, or no mail is written. */
  readonly locale: string
  /** Where the mail leads: an `http:` or `https:` address, or no mail is written. */
  readonly link: string
}

/**
 * The language a mail is written in, once its input is one the mails support: a language they
 * are written in (`mail:LOCALE_UNSUPPORTED` otherwise, never a mail in another one) and a link
 * that is an http or https address (`mail:LINK_INVALID` otherwise). Neither error names the input.
 */
export function checkMailInput({ locale, link }: MailInput): Result<Locale, MailWriteError> {
  const supported = SUPPORTED_LOCALES.find((each) => each === locale)

  if (supported === undefined) {
    return err(LOCALE_UNSUPPORTED)
  }

  const url = URL.parse(link)

  return url !== null && LINK_SCHEMES.has(url.protocol) ? ok(supported) : err(LINK_INVALID)
}
