/** Small persistent key-value storage shared by the tabs of one browser, and what the session keeps in it. */

export { ACCOUNT_START_KEY, keptAccountStart } from './account-start'
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
export { PASSWORD_RESET_KEY, savePasswordReset } from './password-reset'
export {
  addPendingRevoke,
  forgetPendingRevoke,
  PENDING_REVOKE_LIMIT,
  type PendingToken,
  pendingRevokes,
} from './pending-revokes'
export {
  forgetDevice,
  IDENTITY_KEY,
  type KeptDevice,
  saveDevice,
  savedIdentity,
  savedToken,
  saveIdentityEmail,
  TOKEN_KEY,
} from './signed-in'
export { forgetSigningOut, saveSigningOut, signingOutSince } from './signing-out'
export { savedTenantDatabases, saveTenantDatabases, TENANT_DATABASES_KEY } from './tenant-databases'
