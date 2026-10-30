import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { createFormats, type Formats } from './formats'
import { type Catalogs, createTranslator, type Locale, type Translate } from './translator'

interface I18nValue {
  readonly locale: Locale
  readonly t: Translate
  readonly formats: Formats
}

const I18nContext = createContext<I18nValue | undefined>(undefined)

export interface I18nProviderProps {
  readonly locale: Locale
  readonly catalogs: Catalogs
  /** The IANA time zone moments are written in; the runtime's own when left out. */
  readonly timeZone?: string | undefined
  readonly children: ReactNode
}

export function I18nProvider({ locale, catalogs, timeZone, children }: I18nProviderProps) {
  const value = useMemo(
    () => ({
      locale,
      t: createTranslator(catalogs, locale) as Translate,
      formats: createFormats(locale, timeZone),
    }),
    [locale, catalogs, timeZone],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext)

  if (!value) {
    throw new Error('useT, useLocale and useFormats need an I18nProvider above the component')
  }

  return value
}

export const useT = (): Translate => useI18n().t

export const useLocale = (): Locale => useI18n().locale

/** The formats of the current language, for moments, numbers and distances in time. */
export const useFormats = (): Formats => useI18n().formats
