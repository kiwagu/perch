import { createTranslator, type Locale, type Translate } from '@workspace/i18n/translator'

import en from './i18n/mail.en.json'
import es from './i18n/mail.es.json'

/** A key of the mails' catalogs. */
export type MailKey = keyof typeof en

/** The translator of the mails' catalogs in `locale`. */
export function mailTranslator(locale: Locale): Translate<MailKey> {
  return createTranslator({ en, es }, locale)
}
