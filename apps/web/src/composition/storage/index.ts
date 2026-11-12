/** Small persistent key-value storage shared by the tabs of one browser, and what the session keeps in it. */

export { accountStartKeyOf, keptAccountStart } from './account-start'
export { deviceIdFrom } from './device'
export {
  browserStorage,
  type KeyValueStorage,
  type MemoryStorage,
  memoryStorage,
  type StorageEvents,
} from './key-value'
export {
  addLeftoverIdentity,
  dropLeftoverIdentity,
  LEFTOVER_IDENTITIES_KEY,
  leftoverIdentities,
} from './leftover-identities'
export {
  isMembershipsKey,
  membershipsKeyOf,
  savedMemberships,
  savedTenant,
  saveMemberships,
  saveTenant,
} from './memberships'
export { forgetNotice, markSignIn, savedNotice, saveNotice, signInMark } from './notice'
export { PASSWORD_RESET_KEY, savePasswordReset } from './password-reset'
export {
  addPendingRevoke,
  forgetPendingRevoke,
  PENDING_REVOKE_LIMIT,
  type PendingToken,
  pendingRevokes,
} from './pending-revokes'
export { dropRole, forgetRoles, isRolesKey, rolesKeyOf, savedRoles, saveRoles } from './roles'
export {
  CURRENT_KEY,
  type KeptSession,
  newSignInId,
  type SignInId,
  type SignInOwner,
} from './sign-in'
export {
  dropUnreadableSignIn,
  forgetSignIn,
  isSessionKey,
  type KeptDevice,
  type SavedSignIn,
  saveDevice,
  savedIdentity,
  savedSession,
  savedSignIn,
  savedToken,
  savedTokenOf,
  saveIdentityEmail,
  sessionKept,
  signedInKeyOf,
} from './signed-in'
export { forgetSigningOut, saveSigningOut, signingOutSince } from './signing-out'
export {
  forgetSyncLeader,
  SYNC_LEADER_KEY,
  type SyncLeader,
  savedSyncLeader,
  saveSyncLeader,
} from './sync-leader'
export { savedTenantDatabases, saveTenantDatabases, TENANT_DATABASES_KEY } from './tenant-databases'
