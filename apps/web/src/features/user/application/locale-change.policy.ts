import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'

/**
 * How the application language and the one stored in the settings meet. A stored language
 * this device has not seen yet and did not write itself, the first to arrive or one another
 * device stored meanwhile, is applied here. Otherwise the current language is stored when it
 * differs from the stored one and is not already on its way: a choice made here, a return to
 * a language included while an earlier write of this device is still arriving. A device never
 * stores back a language only because another device changed the stored one.
 */
export function localeChange(input: {
  readonly stored: string | undefined
  /** The stored language as this device last saw it; none before the first arrives. */
  readonly seen: string | undefined
  /** The languages this device stored that have not arrived back yet, oldest first. */
  readonly written: readonly string[]
  readonly current: Locale
}): { readonly apply: Locale } | { readonly save: Locale } | undefined {
  const stored = SUPPORTED_LOCALES.find((locale) => locale === input.stored)

  if (stored && input.stored !== input.seen && !input.written.includes(stored)) {
    return stored === input.current ? undefined : { apply: stored }
  }

  return stored === input.current || input.written.at(-1) === input.current
    ? undefined
    : { save: input.current }
}
