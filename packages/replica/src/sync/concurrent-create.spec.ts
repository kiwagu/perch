import { afterEach, describe, expect, it } from 'vitest'

import { type Command, ShapeRunner } from '@workspace/data'
import { CONTRACT_ROLES } from '@workspace/kernel'

import {
  acmeSettingsId,
  acmeSettingsKey,
  createOrganisationSettings,
  organisationSettings,
  organisationSettingsSchema,
  updateLocale,
} from '../__fixtures__/organisation-settings'
import { createProfile, profileById, profileSchema } from '../__fixtures__/profile'
import type { Membership } from '../protocol'
import { LoroWritePath } from '../write-path'

import {
  acme,
  acmeRegion,
  ann,
  bob,
  closeDevices,
  type Device,
  type Gateway,
  identity,
  openDevice,
  openGateway,
  profileKey,
  settleAll,
} from './__fixtures__/devices'

/**
 * A record two devices create under the one id each derives, before either create reached the
 * gateway: both creates are one record at the gateway and on every device, and the value one of
 * them set stays. Ann's device writes as peer 1 and Bob's as peer 2, so where their creates carry
 * the same Lamport time, Bob's comes out on top of Ann's in a conflict over the record's key.
 */

afterEach(async () => {
  await closeDevices()
})

/** Ann and Bob are admins of Acme: both may create and update its settings. */
const admins: Membership = { ...acme, role: CONTRACT_ROLES.admin }

async function gateway(): Promise<Gateway> {
  return openGateway({ schema: organisationSettingsSchema, memberships: [admins] })
}

/** A device of an admin of Acme, not started: what it writes waits for its engine. */
function admin(at: Gateway, identity: string, peerId: bigint, device?: string): Promise<Device> {
  return openDevice(at, {
    identity,
    region: acmeRegion,
    peerId,
    ...(device === undefined ? {} : { device }),
  })
}

/** A command and its params, run on a write path; resolves to whether it went through. */
type Write = (path: LoroWritePath) => Promise<boolean>

const ok =
  <Params>(command: Command<Params>, params: Params): Write =>
  async (path) =>
    (await path.run(command, params)).isOk()

async function write(device: Device, run: Write) {
  expect(await run(new LoroWritePath(device.region, organisationSettingsSchema))).toBe(true)
  device.engine.localWrite()
}

const create = ok(createOrganisationSettings, { id: acmeSettingsId })

const setSpanish = ok(updateLocale, { id: acmeSettingsId, locale: 'es' })

/** What the gateway holds: its projection, and the record a device that joins now pulls. */
async function heldAt(at: Gateway) {
  const late = await admin(at, ann, 3n, 'late-device')

  late.engine.start()
  await settleAll([late])

  return {
    projected: (await new ShapeRunner(at.server).read(organisationSettings, {}))._unsafeUnwrap(),
    pulled: late.region.recordJson(acmeSettingsKey),
  }
}

describe('a record two devices create before either create reached the gateway', () => {
  it.each([
    ['the setter reaches the gateway first', 'setter'],
    ['the empty create reaches the gateway first', 'empty'],
  ] as const)(
    "keeps the language an admin set when another admin created the organisation's settings row too (%s)",
    async (_, first) => {
      const at = await gateway()
      const annsDevice = await admin(at, ann, 1n)
      const bobsDevice = await admin(at, bob, 2n)

      // Both catch up with the organisation's empty region.
      for (const device of [annsDevice, bobsDevice]) {
        device.engine.start()
      }

      await settleAll([annsDevice, bobsDevice])
      await annsDevice.engine.caughtUp(acmeRegion.id, 60_000)
      await bobsDevice.engine.caughtUp(acmeRegion.id, 60_000)

      // Their pushes wait while each creates the row and Ann gives it a language.
      for (const device of [annsDevice, bobsDevice]) {
        device.transport.goOffline()
      }

      await write(annsDevice, create)
      await write(annsDevice, setSpanish)
      await write(bobsDevice, create)

      const [one, two] = first === 'setter' ? [annsDevice, bobsDevice] : [bobsDevice, annsDevice]

      one.transport.goOnline()
      await settleAll([one])
      two.transport.goOnline()
      await settleAll([one, two])

      expect(annsDevice.region.recordJson(acmeSettingsKey)).toEqual({ locale: 'es' })
      expect(bobsDevice.region.recordJson(acmeSettingsKey)).toEqual({ locale: 'es' })
      expect(await heldAt(at)).toEqual({
        projected: [expect.objectContaining({ locale: 'es' })],
        pulled: { locale: 'es' },
      })
      expect(at.stub.rejections()).toBe(0)
      expect([...annsDevice.errors, ...bobsDevice.errors]).toEqual([])
    },
  )

  it('keeps the language the gateway holds when a device creates the row on a document that has not pulled yet, as one a reset emptied', async () => {
    const at = await gateway()
    const annsDevice = await admin(at, ann, 1n)

    await write(annsDevice, create)
    await write(annsDevice, setSpanish)
    annsDevice.engine.start()
    await settleAll([annsDevice])

    // Bob's document holds nothing of the region yet, and a start lets its create through.
    const bobsDevice = await admin(at, bob, 2n)

    await write(bobsDevice, create)
    bobsDevice.engine.start()
    await settleAll([annsDevice, bobsDevice])

    expect(bobsDevice.region.recordJson(acmeSettingsKey)).toEqual({ locale: 'es' })
    expect(annsDevice.region.recordJson(acmeSettingsKey)).toEqual({ locale: 'es' })
    expect(await heldAt(at)).toEqual({
      projected: [expect.objectContaining({ locale: 'es' })],
      pulled: { locale: 'es' },
    })
    expect(at.stub.rejections()).toBe(0)
    expect([...annsDevice.errors, ...bobsDevice.errors]).toEqual([])
  })
})

describe("the account's own record two of its devices create", () => {
  it('orders a field both creates write like two concurrent writes of it: equal in Lamport time, the larger peer', async () => {
    const at = await openGateway()
    const first = await openDevice(at, { peerId: 1n })
    const second = await openDevice(at, { peerId: 2n, device: 'second-device' })
    const profile = (name: string) => ({
      id: 'prf_1',
      identity,
      name,
      email: 'ann@example.test',
    })

    for (const [device, name] of [
      [first, 'Ann'],
      [second, 'Annie'],
    ] as const) {
      expect(
        (
          await new LoroWritePath(device.region, profileSchema).run(createProfile, profile(name))
        ).isOk(),
      ).toBe(true)
      device.engine.localWrite()
    }

    first.engine.start()
    await settleAll([first])
    second.engine.start()
    await settleAll([first, second])

    for (const device of [first, second]) {
      expect(device.region.recordJson(profileKey)).toEqual({
        identity: `identity:${identity}`,
        name: 'Annie',
        email: 'ann@example.test',
      })
    }

    expect(
      (await new ShapeRunner(at.server).read(profileById, { id: 'prf_1' }))._unsafeUnwrap(),
    ).toMatchObject({ name: 'Annie' })
    expect(at.stub.rejections()).toBe(0)
  })
})
