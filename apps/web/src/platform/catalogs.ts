import type { Catalog } from '@workspace/i18n'

import deviceEn from '../features/device/presentation/i18n/device.en.json'
import notFoundEn from '../features/not-found/presentation/i18n/not-found.en.json'
import organisationEn from '../features/organisation/presentation/i18n/organisation.en.json'
import userEn from '../features/user/presentation/i18n/user.en.json'

import appEn from './i18n/app.en.json'

/** Every English catalog of the application; feature catalogs are added here. */
export const englishCatalog: Catalog = {
  ...appEn,
  ...userEn,
  ...organisationEn,
  ...deviceEn,
  ...notFoundEn,
}

/** The Spanish catalogs, loaded when the user chooses Spanish. */
export async function loadSpanishCatalog(): Promise<Catalog> {
  // A dynamic import keeps the second language out of the first download.
  const [app, user, organisation, device, notFound] = await Promise.all([
    import('./i18n/app.es.json'),
    import('../features/user/presentation/i18n/user.es.json'),
    import('../features/organisation/presentation/i18n/organisation.es.json'),
    import('../features/device/presentation/i18n/device.es.json'),
    import('../features/not-found/presentation/i18n/not-found.es.json'),
  ])

  return {
    ...app.default,
    ...user.default,
    ...organisation.default,
    ...device.default,
    ...notFound.default,
  }
}
