import { errAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { privateRegionId } from '@workspace/replica'

import { keysOf } from '../retained-tenant-databases'
import { openRegionSpace, TenantSpaces } from '../tenant-space'

import type { IdentitySpaceOptions } from './options'
import { type IdentitySpace, Space } from './space'

/** Lets go of what the options handed over, when no space takes them. */
function abandon(options: IdentitySpaceOptions): void {
  options.leadership?.stop()
  options.hints.close()
}

/**
 * Opens the identity's database and its private region `identity:<id>`, and the database and
 * region `tenant:<key>` of each organisation it belongs to (one that does not open is reported and
 * left out), projects each region into its database and syncs them while this tab leads. The space
 * owns the leadership and the hints it is given: it stops them when it closes, or at once when
 * its own database cannot open.
 */
export function openIdentitySpace(
  options: IdentitySpaceOptions,
): ResultAsync<IdentitySpace, DataError> {
  const id = options.identity.id

  // Counted before they open: a database that opens only in part is still found and deleted.
  options.tenantDatabases.add([...keysOf(options.memberships)])

  return openRegionSpace({
    openLocal: () => options.openLocal(id),
    ref: { kind: 'private', id: privateRegionId(id) },
    schema: options.schema,
    onError: options.onError,
  })
    .orElse((error) => {
      abandon(options)

      return errAsync(error)
    })
    .andThen((own) =>
      TenantSpaces.open(
        {
          identity: id,
          openLocal: options.openTenantLocal,
          schema: options.schema,
          onError: options.onError,
        },
        options.memberships,
        options.tenant,
      ).map((tenants): IdentitySpace => new Space(own, tenants, options)),
    )
}
