/**
 * An organisation's settings: one row per organisation in its tenant region, under an id every
 * admin's device derives from the organisation, created empty by whichever device needs it first
 * and given a language later. Admins create and update it; nobody deletes it.
 */

import type { Command, Shape } from '@workspace/data'
import { CONTRACT_ROLES } from '@workspace/kernel'

import type { ReplicaSchema } from '../schema'

import createText from './create-organisation-settings.surql'
import rowsText from './organisation-settings.surql'
import updateLocaleText from './update-organisation-locale.surql'

export const organisationSettingsSchema: ReplicaSchema = {
  organisation_settings: {
    region: 'tenant',
    fields: {
      locale: { kind: 'plain' },
    },
    can: {
      [CONTRACT_ROLES.admin]: { create: 'any', update: 'any' },
    },
  },
}

/** The one row of the organisation Acme. */
export const acmeSettingsId = 'ost_acme'

export const acmeSettingsKey = `organisation_settings/${acmeSettingsId}`

const id = { name: 'id', type: 'record<organisation_settings>' } as const

export const createOrganisationSettings: Command<{ id: string }> = {
  id: 'organisation.organisation-settings.createOrganisationSettings',
  kind: 'command',
  text: createText,
  params: [id],
  tables: ['organisation_settings'],
  region: 'tenant',
  ops: [{ op: 'create', record: 'id', fields: {} }],
}

export const updateLocale: Command<{ id: string; locale: string }> = {
  id: 'organisation.organisation-settings.updateLocale',
  kind: 'command',
  text: updateLocaleText,
  params: [id, { name: 'locale', type: 'string' }],
  tables: ['organisation_settings'],
  region: 'tenant',
  ops: [{ op: 'set', record: 'id', field: 'locale', value: { param: 'locale' } }],
}

export interface OrganisationSettingsRow {
  readonly id: string
  readonly locale?: string
}

/** The rows of the table as a database projected them. */
export const organisationSettings: Shape<Record<string, never>, OrganisationSettingsRow[]> = {
  id: 'fixture.organisation-settings',
  kind: 'shape',
  text: rowsText,
  params: [],
  tables: ['organisation_settings'],
}
