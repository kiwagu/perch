/** Small persistent key-value storage shared by the tabs of one browser, and what the session keeps in it. */

export { deviceIdFrom } from './device'
export {
  browserStorage,
  type KeyValueStorage,
  type MemoryStorage,
  memoryStorage,
  type StorageEvents,
} from './key-value'
export {
  MEMBERSHIPS_KEY,
  savedMemberships,
  savedTenant,
  saveMemberships,
  saveTenant,
} from './memberships'
export { forgetNotice, savedNotice, saveNotice } from './notice'
export {
  addPendingRevoke,
  forgetPendingRevoke,
  PENDING_REVOKE_LIMIT,
  type PendingPair,
  pendingRevokes,
} from './pending-revokes'
export {
  ACCESS_KEY,
  forgetDevice,
  IDENTITY_KEY,
  saveDevice,
  savedIdentity,
  savedKeys,
  saveKeys,
} from './signed-in'
export { forgetSigningOut, saveSigningOut, signingOutSince } from './signing-out'
export { savedTenantDatabases, saveTenantDatabases, TENANT_DATABASES_KEY } from './tenant-databases'
