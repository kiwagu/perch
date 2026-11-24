import { okAsync, type ResultAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'

import type { BusError } from '@workspace/cqrs'
import type { Command } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { replicaSchema } from '@workspace/database/replica-schema'
import { identityIdFactory } from '@workspace/ids'
import { type Ability, CONTRACT_ROLES, defineAbilityFor } from '@workspace/kernel'

import type { CommandsPort } from '../../../../platform/commands.port'
import type { TenantCommandsPort } from '../../../../platform/tenant-commands.port'

import {
  type OrganisationSettingsResult,
  organisationSettingsCommands,
  organisationSettingsShape,
} from './organisation-settings.model.gen'
import { OrganisationSettingsService } from './organisation-settings.service'
import { organisationSettingsIdOf } from './organisation-settings-id'

/** Records the commands it is asked to run, by the organisation they go to, and runs none. */
class RecordingTenantCommands implements TenantCommandsPort {
  readonly calls: Array<{ readonly key: string; readonly id: string; readonly params: unknown }> =
    []

  forTenant(key: string): CommandsPort {
    return {
      execute: <Params>(command: Command<Params>, params: Params): ResultAsync<void, BusError> => {
        this.calls.push({ key, id: command.id, params })

        return okAsync(undefined)
      },
    }
  }
}

const ann = identityIdFactory.create()

let runner: FakeShapeRunner
let tenants: RecordingTenantCommands
let ability: Ability
let service: OrganisationSettingsService

beforeEach(() => {
  runner = new FakeShapeRunner()
  tenants = new RecordingTenantCommands()
  ability = defineAbilityFor({ id: ann, role: CONTRACT_ROLES.admin }, replicaSchema)
  service = new OrganisationSettingsService(
    runner,
    tenants,
    { shape: organisationSettingsShape, commands: organisationSettingsCommands },
    () => ability,
  )
})

describe('the organisation settings model', () => {
  it('creates the row with no field and removes the language with an unset', () => {
    expect(organisationSettingsCommands.createOrganisationSettings.ops).toEqual([
      { op: 'create', record: 'id', fields: {} },
    ])
    expect(organisationSettingsCommands.clearLocale.ops).toEqual([
      { op: 'unset', record: 'id', field: 'locale' },
    ])
  })
})

describe('OrganisationSettingsService', () => {
  it('derives the one row of an organisation from its key', () => {
    expect(organisationSettingsIdOf('acme')).toBe('ost_acme')
  })

  it('watches the one row of the organisation it is asked about', () => {
    const row: OrganisationSettingsResult = [{ id: organisationSettingsIdOf('acme'), locale: 'es' }]
    const seen: unknown[] = []

    runner.set(organisationSettingsShape, row)
    service.watch('acme', (tree) => seen.push(tree))

    expect(seen).toEqual([row])
    expect(runner.lastParams(organisationSettingsShape)).toEqual({
      id: organisationSettingsIdOf('acme'),
    })
  })

  it('sets then removes the language of the organisation acted on, whichever is current', async () => {
    expect((await service.setLanguage('acme', 'es')).isOk()).toBe(true)
    expect((await service.clearLanguage('acme')).isOk()).toBe(true)

    expect(tenants.calls).toEqual([
      {
        key: 'acme',
        id: organisationSettingsCommands.updateLocale.id,
        params: { id: 'ost_acme', locale: 'es' },
      },
      { key: 'acme', id: organisationSettingsCommands.clearLocale.id, params: { id: 'ost_acme' } },
    ])
  })

  it("refuses a member's change before any command runs", async () => {
    ability = defineAbilityFor({ id: ann, role: CONTRACT_ROLES.member }, replicaSchema)

    const set = await service.setLanguage('acme', 'es')
    const cleared = await service.clearLanguage('acme')

    expect(set._unsafeUnwrapErr().code).toBe('organisation_settings:FORBIDDEN')
    expect(cleared._unsafeUnwrapErr().code).toBe('organisation_settings:FORBIDDEN')
    expect(tenants.calls).toEqual([])
  })
})
