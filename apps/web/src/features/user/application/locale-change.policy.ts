import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'

/**
 * How the application language and the one stored in the profile meet: the
 * stored one wins when the profile first arrives on this device, and after that
 * the user's choice is stored.
 */
export function localeChange(input: {
  readonly stored: string | undefined
  readonly current: Locale
  readonly first: boolean
}): { readonly apply: Locale } | { readonly save: Locale } | undefined {
  const stored = SUPPORTED_LOCALES.find((locale) => locale === input.stored)

  if (input.first && stored) {
    return stored === input.current ? undefined : { apply: stored }
  }

  return stored === input.current ? undefined : { save: input.current }
}
