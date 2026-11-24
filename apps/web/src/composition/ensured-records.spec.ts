import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShapeRunner } from '@workspace/data'
import {
  identityIdFactory,
  noteIdFactory,
  profileIdFactory,
  settingsIdFactory,
  tenantIdFactory,
} from '@workspace/ids'
import { CONTRACT_ROLES } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import {
  organisationSettingsCommands,
  organisationSettingsShape,
} from '../features/organisation/application/organisation-settings/organisation-settings.model.gen'
import { organisationSettingsIdOf } from '../features/organisation/application/organisation-settings/organisation-settings-id'
import {
  settingsCommands,
  settingsShape,
} from '../features/user/application/settings/settings.model.gen'
import {
  profileCommands,
  profileShape,
} from '../features/user/presentation/pages/profile/profile.model.gen'

import { createNote } from './__fixtures__/note'
import { openTestWorld, type TestGateway, type TestWorld } from './__fixtures__/session'
import { signedIn } from './__fixtures__/signed-in'
import { type KeptDevice, memoryStorage } from './storage'

/**
 * The records each device of an account or of an organisation's admins creates under the one id
 * they all derive: the account's settings and profile, the organisation's settings. Two devices
 * that create one before either create reached the gateway end with one record, at the gateway
 * and on both, and what either of them set on it after its create stays.
 */

const acme: Membership = {
  tenant: { id: tenantIdFactory.create(), key: 'acme', name: 'Acme' },
  role: CONTRACT_ROLES.admin,
}

const ann: KeptDevice = {
  identity: { id: identityIdFactory.create(), email: 'ann@example.test' },
  token: 'token-ann',
  memberships: [acme],
}

const worlds: TestWorld[] = []

afterEach(async () => {
  await Promise.all(worlds.splice(0).map((world) => world.close()))
})

/**
 * A browser of Ann's, signed in and leading its tabs, whose gateway is out of reach until the
 * spec brings it up; on `gateway` when given, a gateway of its own otherwise.
 */
async function browser(gateway?: TestGateway): Promise<TestWorld> {
  const storage = memoryStorage()

  signedIn(storage, ann)

  const world = await openTestWorld({
    storage,
    online: false,
    network: true,
    memberships: [acme],
    ...(gateway ? { gateway } : {}),
  })

  worlds.push(world)
  expect((await world.session.restore()).isOk()).toBe(true)
  await vi.waitFor(() => expect(world.states.at(-1)).toMatchObject({ leader: true }))

  return world
}

/** Brings each browser's gateway up and waits until each has sent and taken in everything. */
async function synced(browsers: readonly TestWorld[]): Promise<void> {
  for (const world of browsers) {
    for (const transport of world.transports()) {
      transport.goOnline()
    }
  }

  // A browser settles once its own batches are acknowledged; a second round takes the others' in.
  for (let round = 0; round < 2; round += 1) {
    for (const world of browsers) {
      await (world.session.space()?.sync ?? expect.unreachable('it leads')).settled(30_000)
    }
  }
}

function ok(written: { isOk(): boolean }): void {
  expect(written.isOk()).toBe(true)
}

describe('a record two devices ensure before either create reached the gateway', () => {
  it("keeps an organisation's language when two of its admin's browsers created its settings row", async () => {
    const id = organisationSettingsIdOf('acme')
    const first = await browser()
    const second = await browser(first.gateway)
    const writesOf = (world: TestWorld) => world.session.tenantWritePath('acme')

    // The first browser creates the row and gives it a language.
    ok(await writesOf(first).run(organisationSettingsCommands.createOrganisationSettings, { id }))
    ok(await writesOf(first).run(organisationSettingsCommands.updateLocale, { id, locale: 'es' }))
    // The second wrote in the organisation before, so its create comes later in the record's order.
    ok(
      await writesOf(second).run(createNote, {
        id: noteIdFactory.create(),
        author: ann.identity.id,
        text: 'agenda',
      }),
    )
    ok(await writesOf(second).run(organisationSettingsCommands.createOrganisationSettings, { id }))

    await synced([first, second])

    for (const world of [first, second]) {
      const view = world.session.space()?.tenant('acme') ?? expect.unreachable('acme open')

      expect((await view.runner.read(organisationSettingsShape, { id }))._unsafeUnwrap()).toEqual([
        { id, locale: 'es' },
      ])
      expect(world.published).toEqual([])
    }

    expect(
      (
        await new ShapeRunner(first.gateway.server).read(organisationSettingsShape, { id })
      )._unsafeUnwrap(),
    ).toEqual([{ id, locale: 'es' }])
  })

  it("keeps what each device set on the account's settings and profile when both devices created them", async () => {
    const identity = ann.identity.id
    const settings = settingsIdFactory.create()
    const profile = profileIdFactory.create()
    const first = await browser()
    const second = await browser(first.gateway)

    for (const world of [first, second]) {
      ok(
        await world.commands.execute(settingsCommands.createSettings, {
          id: settings,
          identity,
          locale: 'es',
          theme: 'system',
        }),
      )
      ok(
        await world.commands.execute(profileCommands.createProfile, {
          id: profile,
          identity,
          name: 'Ann',
          email: 'ann@example.test',
        }),
      )
    }

    // After its creates, each device changes what the other leaves alone.
    ok(await first.commands.execute(settingsCommands.updateLocale, { id: settings, locale: 'en' }))
    ok(await first.commands.execute(profileCommands.updateBio, { id: profile, bio: 'Hello' }))
    ok(await second.commands.execute(settingsCommands.updateTheme, { id: settings, theme: 'dark' }))
    ok(await second.commands.execute(profileCommands.updateName, { id: profile, name: 'Ann B' }))

    await synced([first, second])

    for (const runner of [
      first.session.runner,
      second.session.runner,
      new ShapeRunner(first.gateway.server),
    ]) {
      expect((await runner.read(settingsShape, { identity }))._unsafeUnwrap()).toEqual([
        { id: settings, locale: 'en', theme: 'dark' },
      ])
      expect((await runner.read(profileShape, { identity }))._unsafeUnwrap()).toMatchObject([
        { id: profile, name: 'Ann B', email: 'ann@example.test', bio: 'Hello' },
      ])
    }

    expect([...first.published, ...second.published]).toEqual([])
  })
})
