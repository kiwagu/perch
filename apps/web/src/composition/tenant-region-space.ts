/**
 * The database of one organisation the identity belongs to: the region `tenant:<key>`, in the
 * browser the database `indxdb://app-identity-<id>-t_<key>`, opened as a region space.
 */

import type { ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, tenantRegionId } from '@workspace/data'
import type { RegionDoc, ReplicaSchema } from '@workspace/replica'

import { OpenRegion, openRegion, type RegionSpace, type RegionSpaceOptions } from './region-space'

/** The database and region of one organisation the identity belongs to. */
export interface TenantSpace extends RegionSpace {
  readonly key: string
}

export interface TenantSpaceOptions {
  readonly key: string
  readonly openLocal: () => ResultAsync<LocalDb, DataError>
  readonly schema: ReplicaSchema
  readonly onError: (error: DataError) => void
}

class OpenTenant extends OpenRegion implements TenantSpace {
  constructor(
    readonly key: string,
    region: RegionDoc,
    local: LocalDb,
    options: RegionSpaceOptions,
  ) {
    super(region, local, options)
  }
}

/** Opens the database of the organisation `key` and its region `tenant:<key>`. */
export function openTenantSpace(options: TenantSpaceOptions): ResultAsync<TenantSpace, DataError> {
  const region: RegionSpaceOptions = {
    openLocal: options.openLocal,
    ref: { kind: 'tenant', id: tenantRegionId(options.key) },
    schema: options.schema,
    onError: options.onError,
  }

  return openRegion(region, (doc, local) => new OpenTenant(options.key, doc, local, region))
}
