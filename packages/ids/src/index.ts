/**
 * The single registry of entity id prefixes. A prefix is declared here once;
 * the database schema names the same prefix over each table (`-- @id <prefix>`)
 * and the modeling stage checks the two against each other in both directions.
 *
 * Validation depth is a process-wide mode chosen by the application's
 * composition root (`setValidationMode` from entity-id); this package never sets it.
 */

import { defineEntityPrefixes, type EntityIdOf } from 'entity-id'
import { withSchemas } from 'entity-id/schema'

export const registry = defineEntityPrefixes({
  identity: 'idn',
  profile: 'prf',
  tenant: 'tnt',
  membership: 'mbr',
  device_session: 'dvs',
  note: 'nte',
  settings: 'stg',
  account: 'acc',
  verification: 'vrf',
} as const)

export type EntityKind = keyof typeof registry.prefixes

export type IdentityId = EntityIdOf<typeof registry.prefixes, 'identity'>

export type ProfileId = EntityIdOf<typeof registry.prefixes, 'profile'>

export type TenantId = EntityIdOf<typeof registry.prefixes, 'tenant'>

export type MembershipId = EntityIdOf<typeof registry.prefixes, 'membership'>

export type DeviceSessionId = EntityIdOf<typeof registry.prefixes, 'device_session'>

export type NoteId = EntityIdOf<typeof registry.prefixes, 'note'>

export type SettingsId = EntityIdOf<typeof registry.prefixes, 'settings'>

export type AccountId = EntityIdOf<typeof registry.prefixes, 'account'>

export type VerificationId = EntityIdOf<typeof registry.prefixes, 'verification'>

export const {
  identityIdFactory,
  profileIdFactory,
  tenantIdFactory,
  membershipIdFactory,
  device_sessionIdFactory,
  noteIdFactory,
  settingsIdFactory,
  accountIdFactory,
  verificationIdFactory,
} = registry.factories

export const idSchemas = withSchemas(registry)
