/**
 * One region's database on this device: the region document, loaded from the database and
 * projected into it, a runner over the database and the write path into the document. Each
 * organisation the identity belongs to has one of its own (`openTenantSpace`: the region
 * `tenant:<key>`, in the browser the database `indxdb://app-identity-<id>-t_<key>`), beside the
 * identity's own database, which holds its private region the same way. `TenantSpaces` keeps an
 * identity's organisation databases in step with its memberships. Each class lives in a file of
 * its own; this module is their entry point.
 */

export { openRegionSpace, type RegionSpace, type RegionSpaceOptions } from './region-space'
export { openTenantSpace, type TenantSpace, type TenantSpaceOptions } from './tenant-region-space'
export { TenantSpaces, type TenantSpacesOptions } from './tenant-spaces'
