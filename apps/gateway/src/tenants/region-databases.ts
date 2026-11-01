import { errAsync, okAsync } from 'neverthrow'

import { dataError, type LocalDb, tenantDatabase } from '@workspace/data'
import { tenantKeyOf } from '@workspace/replica'
import type { RegionDatabases } from '@workspace/replica/server'

import { DIRECTORY } from '../config'

import type { TenantDatabases } from './tenant-databases'

/**
 * Where the region hub keeps each region: an identity's private region in the directory,
 * which the gateway keeps open, and an organisation's tenant region in the organisation's own
 * database, held until the hub releases it. No database holds a region of another kind.
 */
export function regionDatabases(
  directory: LocalDb,
  tenants: Pick<TenantDatabases, 'acquire'>,
): RegionDatabases {
  return {
    databaseOf: (region) => {
      const key = tenantKeyOf(region)

      return region.kind === 'private' || key === undefined ? DIRECTORY : tenantDatabase(key)
    },
    acquire: (region) => {
      if (region.kind === 'private') {
        return okAsync({ local: directory, release: () => {} })
      }

      const key = tenantKeyOf(region)

      return key === undefined
        ? errAsync(dataError('data:OPEN_FAILED', `no database holds region ${region.id}`))
        : tenants.acquire(key)
    },
  }
}
