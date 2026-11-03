import { err, ok, type ResultAsync } from 'neverthrow'

import { type DataError, dataError, type LocalDb } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import { reading } from './device-session-rows'
import accountLocaleStatement from './surql/account-locale.surql'

const storedLocale = z.enum(SUPPORTED_LOCALES).nullish()

/**
 * The language an account's settings name, once it has settings; none before. Settings that name
 * a language the gateway does not speak fail, as a read that failed does: neither falls to the
 * language of the sign-up.
 */
export function accountLocale(
  directory: LocalDb,
  identity: IdentityId,
): ResultAsync<Locale | undefined, DataError> {
  return reading(
    directory.db.query<[unknown]>(accountLocaleStatement, { identity }),
    `could not read the language of ${identity}`,
  ).andThen(([value]) => {
    const parsed = storedLocale.safeParse(value)

    return parsed.success
      ? ok(parsed.data ?? undefined)
      : err(
          dataError('data:QUERY_FAILED', 'the settings name a language the gateway does not speak'),
        )
  })
}
