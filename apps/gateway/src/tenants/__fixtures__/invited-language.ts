import type { LocalDb } from '@workspace/data'
import type { Locale } from '@workspace/i18n'
import type { Clock } from '@workspace/replica'

import type { TenantDatabases } from '../tenant-databases'

import organisationSettingsWrite from './organisation-settings-write.surql'
import tenantInvited from './tenant-invited.surql'

/** A week, how long an invitation stays pending. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1_000

/** Where an organisation's invitation and settings are written for a spec. */
export interface InvitingStores {
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire'>
  readonly clock: Clock
}

/**
 * The ready organisation `key` invited `email` just now, and its settings row names `locale` as
 * its default language (none when it is left out), written directly to the directory and the
 * organisation's database, for a spec of the language an invited account starts in.
 */
export async function invitedTo(
  stores: InvitingStores,
  invitation: { readonly key: string; readonly email: string; readonly locale?: Locale },
): Promise<void> {
  const { key, email, locale } = invitation
  const now = stores.clock.now()

  await stores.directory.db.query(tenantInvited, {
    key,
    status: 'ready',
    email,
    created: new Date(now),
    expires: new Date(now + WEEK_MS),
  })

  const handle = (await stores.databases.acquire(key))._unsafeUnwrap()

  try {
    await handle.local.db.query(organisationSettingsWrite, {
      id: `ost_${key}`,
      content: locale === undefined ? {} : { locale },
    })
  } finally {
    handle.release()
  }
}
