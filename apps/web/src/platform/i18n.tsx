import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react'

import { type Catalog, I18nProvider, type Locale } from '@workspace/i18n'

const SetLocaleContext = createContext<(locale: Locale) => void>(() => {})

export interface AppI18nProps {
  readonly initial: Locale
  /** The complete English catalog, bundled with the application. */
  readonly en: Catalog
  /** Loads the Spanish catalog the first time Spanish is chosen. */
  readonly loadEs: () => Promise<Catalog>
  readonly children: ReactNode
}

/** The language of the application: chosen by the user, Spanish loaded on demand, English as fallback. */
export function AppI18n(props: AppI18nProps) {
  const [locale, setLocale] = useState<Locale>(props.initial)
  const [es, setEs] = useState<Catalog | undefined>(undefined)
  const { loadEs } = props

  useEffect(() => {
    document.documentElement.lang = locale

    if (locale === 'es' && !es) {
      void loadEs().then(setEs)
    }
  }, [locale, es, loadEs])

  const catalogs = useMemo(() => ({ en: props.en, ...(es ? { es } : {}) }), [props.en, es])

  return (
    <SetLocaleContext.Provider value={setLocale}>
      <I18nProvider locale={locale} catalogs={catalogs}>
        {props.children}
      </I18nProvider>
    </SetLocaleContext.Provider>
  )
}

export const useSetLocale = (): ((locale: Locale) => void) => useContext(SetLocaleContext)
