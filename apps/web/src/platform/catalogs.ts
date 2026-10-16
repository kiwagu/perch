import type { Catalog } from '@workspace/i18n'

import userEn from '../features/user/presentation/i18n/user.en.json'

import appEn from './i18n/app.en.json'

/** Every English catalog of the application; feature catalogs are added here. */
export const englishCatalog: Catalog = { ...appEn, ...userEn }

/** The Spanish catalogs, loaded when the user chooses Spanish. */
export async function loadSpanishCatalog(): Promise<Catalog> {
  // A dynamic import keeps the second language out of the first download.
  const [app, user] = await Promise.all([
    import('./i18n/app.es.json'),
    import('../features/user/presentation/i18n/user.es.json'),
  ])

  return { ...app.default, ...user.default }
}
