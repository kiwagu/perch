import { type OrganisationSettingsId, organisation_settingsIdFactory } from '@workspace/ids'

/**
 * The one row of the organisation `key`'s settings, the same on every device: `ost_<key>`, so a
 * device that creates it and one that reads it name the same record.
 */
export const organisationSettingsIdOf = (key: string): OrganisationSettingsId =>
  organisation_settingsIdFactory.brand(`${organisation_settingsIdFactory.prefix}_${key}`)
