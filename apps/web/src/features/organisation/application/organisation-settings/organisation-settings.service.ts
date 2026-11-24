import { errAsync, type ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command, Shape, ShapeRunnerPort } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import type { OrganisationSettingsId } from '@workspace/ids'
import type { Ability } from '@workspace/kernel'

import type { TenantCommandsPort } from '../../../../platform/tenant-commands.port'

import { organisationSettingsIdOf } from './organisation-settings-id'

/** The organisation's settings as the page reads them: its one row, or none yet; no language: none set. */
export type OrganisationSettingsRow = {
  readonly id: OrganisationSettingsId
  readonly locale?: string | undefined
}

/** The reads and writes the service needs; the module passes the ones the modeling stage generated. */
export interface OrganisationSettingsModel {
  readonly shape: Shape<{ readonly id: OrganisationSettingsId }, readonly OrganisationSettingsRow[]>
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
 * Reads and changes the settings of an organisation, named by its key: a change goes to the
 * organisation the admin acted on, never to another that became current meanwhile.
 */
export class OrganisationSettingsService {
  constructor(
    private readonly runner: ShapeRunnerPort,
    private readonly tenants: TenantCommandsPort,
    private readonly model: OrganisationSettingsModel,
    /** What the signed-in member may do in the current organisation, asked at each change. */
    private readonly ability: () => Ability,
  ) {}

  watch(key: string, onTree: (tree: readonly OrganisationSettingsRow[]) => void): () => void {
    return this.runner.watch(this.model.shape, { id: organisationSettingsIdOf(key) }, onTree)
  }

  setLanguage(key: string, locale: Locale): ResultAsync<void, BusError> {
    return this.ability().can('update', 'organisation_settings')
      ? this.tenants
          .forTenant(key)
          .execute(this.model.commands.updateLocale, { id: organisationSettingsIdOf(key), locale })
      : errAsync(forbidden)
  }

  clearLanguage(key: string): ResultAsync<void, BusError> {
    return this.ability().can('update', 'organisation_settings')
      ? this.tenants
          .forTenant(key)
          .execute(this.model.commands.clearLocale, { id: organisationSettingsIdOf(key) })
      : errAsync(forbidden)
  }
}

export const ORGANISATION_SETTINGS_SERVICE = token<OrganisationSettingsService>(
  'OrganisationSettingsService',
)
