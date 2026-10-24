import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'

/**
 * How the application language and the one stored in the settings meet: a stored language
 * this device has not seen yet, the first to arrive or one another device stored meanwhile,
 * is applied here; while the stored one stays as this device last saw it, a language the user
 * chose here is stored. A device never stores back a language only because another device
 * changed the stored one.
 */
export function localeChange(input: {
  readonly stored: string | undefined
  /** The stored language as this device last saw it; none before the first arrives. */
  readonly seen: string | undefined
  readonly current: Locale
}): { readonly apply: Locale } | { readonly save: Locale } | undefined {
  const stored = SUPPORTED_LOCALES.find((locale) => locale === input.stored)

  if (stored && input.stored !== input.seen) {
    return stored === input.current ? undefined : { apply: stored }
  }

  return stored === input.current ? undefined : { save: input.current }
}
