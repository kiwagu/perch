import { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n'
import { z } from '@workspace/zod'

import { answered } from './invitations'
import { reading } from './organisation-rows'
import organisationLocaleStatement from './surql/organisation-locale.surql'
import type { TenantDatabases } from './tenant-databases'

const localeOf = z.string().nullish()

/**
 * The default language of the organisation `key`, read from its own settings row (`ost_<key>`) in
 * its database, which is let go once the read settles: none when the row names none, is not there
 * yet, or names a language the app does not speak.
 */
export function organisationLocale(
  databases: Pick<TenantDatabases, 'acquire'>,
  key: string,
): ResultAsync<Locale | undefined, DataError> {
  return databases.acquire(key).andThen((handle) => {
    const read = async () => {
      try {
        return await reading(
          handle.local.db.query(organisationLocaleStatement, { id: `ost_${key}` }),
          `the default language of ${key} could not be read`,
        ).andThen((answer) =>
          answered(localeOf, answer, `the answer to the default language of ${key}`),
        )
      } finally {
        handle.release()
      }
    }

    return new ResultAsync(read()).map((locale) =>
      SUPPORTED_LOCALES.find((supported) => supported === locale),
    )
  })
}
