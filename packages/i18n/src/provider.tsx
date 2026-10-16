import { createContext, type ReactNode, useContext, useMemo } from 'react'

import { type Catalogs, createTranslator, type Locale, type Translate } from './translator'

interface I18nValue {
  readonly locale: Locale
  readonly t: Translate
}

const I18nContext = createContext<I18nValue | undefined>(undefined)

export interface I18nProviderProps {
  readonly locale: Locale
  readonly catalogs: Catalogs
  readonly children: ReactNode
}

export function I18nProvider({ locale, catalogs, children }: I18nProviderProps) {
  const value = useMemo(
    () => ({ locale, t: createTranslator(catalogs, locale) as Translate }),
    [locale, catalogs],
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext)

  if (!value) {
    throw new Error('useT and useLocale need an I18nProvider above the component')
  }

  return value
}

export const useT = (): Translate => useI18n().t

export const useLocale = (): Locale => useI18n().locale
