/**
 * The translator of the workspace: flat, greppable keys (`user.profile.save`),
 * `{name}` parameters, plural forms as `<key>.one` / `<key>.other` chosen by
 * `Intl.PluralRules`, and a two-step fallback: the chosen language, then English,
 * then the key itself so a missing string is visible instead of blank.
 */

export const SUPPORTED_LOCALES = ['en', 'es'] as const

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export type Catalog = Readonly<Record<string, string>>

type PluralBase<Key> =
  Key extends `${infer Base}.${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? Base : never

/** The keys of a catalog plus the base keys of its plural groups. */
export type KeyOf<C extends Catalog> =
  | Extract<keyof C, string>
  | PluralBase<Extract<keyof C, string>>

export type TranslationParams = Readonly<Record<string, string | number>>

export type Translate<Key extends string = string> = (
  key: Key,
  params?: TranslationParams,
) => string

export interface Catalogs<C extends Catalog = Catalog> {
  readonly en: C
  readonly es?: Catalog
}

const substitute = (text: string, params: TranslationParams | undefined): string =>
  params ? text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match)) : text

export function createTranslator<C extends Catalog>(
  catalogs: Catalogs<C>,
  locale: Locale,
): Translate<KeyOf<C>> {
  const primary: Catalog = locale === 'en' ? catalogs.en : (catalogs.es ?? {})
  const plural = new Intl.PluralRules(locale)
  const lookup = (key: string): string | undefined => primary[key] ?? catalogs.en[key]

  return (key, params) => {
    const count = params?.['count']

    if (typeof count === 'number') {
      const form = lookup(`${key}.${plural.select(count)}`) ?? lookup(`${key}.other`)

      if (form !== undefined) {
        return substitute(form, params)
      }
    }

    return substitute(lookup(key) ?? key, params)
  }
}

/** The supported language of a browser language tag such as `es-AR`; English otherwise. */
export function matchLocale(tag: string | undefined): Locale {
  const language = tag?.toLowerCase().split('-')[0]

  return SUPPORTED_LOCALES.find((locale) => locale === language) ?? DEFAULT_LOCALE
}
