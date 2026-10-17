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
} as const)

export type EntityKind = keyof typeof registry.prefixes

export type IdentityId = EntityIdOf<typeof registry.prefixes, 'identity'>

export type ProfileId = EntityIdOf<typeof registry.prefixes, 'profile'>

export const { identityIdFactory, profileIdFactory } = registry.factories

export const idSchemas = withSchemas(registry)
