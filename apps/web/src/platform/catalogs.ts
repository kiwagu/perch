import type { Catalog } from '@workspace/i18n'

import appEn from './i18n/app.en.json'

/** Every English catalog of the application; feature catalogs are added here. */
export const englishCatalog: Catalog = { ...appEn }

/** The Spanish catalogs, loaded when the user chooses Spanish. */
export async function loadSpanishCatalog(): Promise<Catalog> {
  // A dynamic import keeps the second language out of the first download.
  const [app] = await Promise.all([import('./i18n/app.es.json')])

  return { ...app.default }
}
