import { errAsync, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import type { OrganisationSettingsId } from '@workspace/ids'
import type { Ability } from '@workspace/kernel'

import type { TenantCommandsPort } from '../../../../platform/tenant-commands.port'

import { organisationSettingsIdOf } from './organisation-settings-id'

/** The writes the service needs; the module passes the ones the modeling stage generated. */
export interface OrganisationSettingsModel {
  readonly commands: {
    readonly updateLocale: Command<{ readonly id: OrganisationSettingsId; readonly locale: Locale }>
    readonly clearLocale: Command<{ readonly id: OrganisationSettingsId }>
  }
}

const forbidden: BusError = {
  code: 'organisation_settings:FORBIDDEN',
  message: 'only an admin of the organisation may change its settings',
}

/**
 * Changes the settings of an organisation, named by its key: a change goes to the organisation the
 * admin acted on, never to another that became current meanwhile, and is admitted only while the
 * account is still that organisation's admin.
 */
export class OrganisationSettingsService {
  constructor(
    private readonly tenants: TenantCommandsPort,
    private readonly model: OrganisationSettingsModel,
    /** What the signed-in member may do in the current organisation, asked at each change. */
    private readonly ability: () => Ability,
    /** Whether the account is admin of the organisation `key` now. */
    private readonly adminOf: (key: string) => boolean,
  ) {}

  setLanguage(key: string, locale: Locale): ResultAsync<void, BusError> {
    return this.#run(key, this.model.commands.updateLocale, {
      id: organisationSettingsIdOf(key),
      locale,
    })
  }

  clearLanguage(key: string): ResultAsync<void, BusError> {
    return this.#run(key, this.model.commands.clearLocale, { id: organisationSettingsIdOf(key) })
  }

  #run<Params>(key: string, command: Command<Params>, params: Params): ResultAsync<void, BusError> {
    return this.ability().can('update', 'organisation_settings')
      ? this.tenants.forTenant(key, () => this.adminOf(key)).execute(command, params)
      : errAsync(forbidden)
  }
}

export const ORGANISATION_SETTINGS_SERVICE = token<OrganisationSettingsService>(
  'OrganisationSettingsService',
)
