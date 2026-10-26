import type { ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { Command, DataError, Shape, ShapeRunnerPort } from '@workspace/data'
import { token } from '@workspace/di'
import type { Locale } from '@workspace/i18n'
import type { IdentityId, SettingsId } from '@workspace/ids'

import type { CommandsPort } from '../../../../platform/commands.port'

/** The account's settings as this device holds them. */
export interface SettingsRow {
  readonly id: SettingsId
  readonly locale: string
}

export interface SettingsOwner {
  readonly identity: IdentityId
}

export interface NewSettings {
  readonly id: SettingsId
  readonly identity: IdentityId
  readonly locale: Locale
}

/** The reads and writes the service needs; the module passes the ones the modeling stage generated. */
export interface SettingsModel {
  readonly shape: Shape<SettingsOwner, readonly SettingsRow[]>
  readonly commands: {
    readonly createSettings: Command<NewSettings>
    readonly updateLocale: Command<{ readonly id: SettingsId; readonly locale: Locale }>
  }
}

/** Reads and changes the settings of the signed-in account. */
export class SettingsService {
  constructor(
    private readonly runner: ShapeRunnerPort,
    private readonly commands: CommandsPort,
    private readonly model: SettingsModel,
  ) {}

  read(owner: SettingsOwner): ResultAsync<readonly SettingsRow[], DataError> {
    return this.runner.read(this.model.shape, owner)
  }

  watch(owner: SettingsOwner, onTree: (tree: readonly SettingsRow[]) => void): () => void {
    return this.runner.watch(this.model.shape, owner, onTree)
  }

  createSettings(settings: NewSettings): ResultAsync<void, BusError> {
    return this.commands.execute(this.model.commands.createSettings, settings)
  }

  updateLocale(input: {
    readonly id: SettingsId
    readonly locale: Locale
  }): ResultAsync<void, BusError> {
    return this.commands.execute(this.model.commands.updateLocale, input)
  }
}

export const SETTINGS_SERVICE = token<SettingsService>('SettingsService')
