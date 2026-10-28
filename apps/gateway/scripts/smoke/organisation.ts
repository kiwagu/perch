import { noteIdFactory } from '@workspace/ids'
import { RegionDoc } from '@workspace/replica'
import { CLOSE, type Membership, membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { noteCreate, noteDelete, noteUpdate } from '../../src/sync/__fixtures__/note'

import { callAs, postCredentials, type SignedIn } from './http'
import { refusedWriteSteps } from './refused-writes'
import {
  check,
  hello,
  helloOnRefresh,
  type Opened,
  refusal,
  step,
  takeUpdates,
  unwrap,
} from './steps'

const createdOrganisation = z.object({ membership: membership })

const listedMembers = z.object({
  members: z.array(z.object({ identity: z.object({ id: z.string() }) })),
})

/** Whether a welcome's regions name `region`. */
function hasRegion(regions: readonly { readonly region: string }[], region: string): boolean {
  return regions.some((entry) => entry.region === region)
}

/** A welcome's memberships as `<key>:<role>`, the way the steps compare them. */
function rolesOf(memberships: readonly Membership[]): string {
  return memberships.map((entry) => `${entry.tenant.key}:${entry.role}`).join()
}

/**
 * The organisation path: `owner` creates an organisation and invites a second identity into
 * it, whose device writes into the organisation's region, is refused a note in another
 * member's name, and is removed. The organisation and the second identity stay on the stand,
 * for the sweep of `@example.test` accounts.
 */
export async function organisationSteps(
  base: string,
  opened: Opened,
  owner: SignedIn,
  ownerCredentials: { readonly email: string; readonly password: string },
): Promise<void> {
  const key = `smoke_${Date.now().toString(36)}`
  const region = `tenant:${key}`

  await step(`organisation ${key} created: 201 with the owner as admin`, async () => {
    const answer = await callAs(base, 'POST', '/organisations', owner, { key, name: 'Smoke' })

    check(answer.status === 201, `answered ${answer.status} ${JSON.stringify(answer.body)}`)

    const { membership: created } = createdOrganisation.parse(answer.body)

    check(created.tenant.key === key && created.role === 'admin', 'not the admin of the key')
  })

  const guest: SignedIn = await step('signed up a second identity: no memberships', async () => {
    const signedUp = await postCredentials(base, '/auth/sign-up', {
      email: `smoke-${crypto.randomUUID()}@example.test`,
      password: crypto.randomUUID(),
      device: { id: 'smoke-guest-device', label: 'Smoke guest' },
    })

    check(signedUp.memberships.length === 0, 'the new identity belongs to an organisation')

    return signedUp
  })

  await step('the second identity invited: 200', async () => {
    const answer = await callAs(base, 'POST', `/organisations/${key}/members`, owner, {
      email: guest.identity.email,
    })

    check(answer.status === 200, `answered ${answer.status} ${JSON.stringify(answer.body)}`)
  })

  const guestDoc = RegionDoc.inMemory('tenant', region)
  const guestDevice = await step(
    'invited device welcomed with the organisation region',
    async () => {
      const { device, welcome } = await hello(base, opened, guest)

      check(
        rolesOf(welcome.memberships) === `${key}:member`,
        `welcomed with ${JSON.stringify(welcome.memberships)}`,
      )
      check(
        hasRegion(welcome.regions, region),
        `no ${region} in ${JSON.stringify(welcome.regions)}`,
      )

      return device
    },
  )

  await step(
    'invited device subscribed to the organisation region: an empty snapshot',
    async () => {
      guestDevice.subscribe(region)
      check((await takeUpdates(guestDevice, guestDoc, true)) === 0, 'the snapshot is not at head 0')
    },
  )

  const ownerDoc = RegionDoc.inMemory('tenant', region)
  const ownerDevice = await step('owner device subscribed to the organisation region', async () => {
    const { device, welcome } = await hello(base, opened, owner)

    check(
      rolesOf(welcome.memberships) === `${key}:admin`,
      `welcomed with ${JSON.stringify(welcome.memberships)}`,
    )
    check(hasRegion(welcome.regions, region), `no ${region} in ${JSON.stringify(welcome.regions)}`)
    device.subscribe(region)
    check((await takeUpdates(device, ownerDoc, true)) === 0, 'the snapshot is not at head 0')

    return device
  })

  const noteId = noteIdFactory.create()

  await step('invited device pushed a note: ack at head 1, owner device received it', async () => {
    const created = await noteCreate(guestDoc, {
      id: noteId,
      author: guest.identity.id,
      text: 'Hello team',
    })

    guestDevice.push(region, 1, unwrap(created))

    const ack = await guestDevice.next('ack')

    check(ack.batch === 1 && ack.head === 1, `ack of batch ${ack.batch} at head ${ack.head}`)
    check((await takeUpdates(ownerDevice, ownerDoc, false)) === 1, 'owner got no update at head 1')
    check(ownerDoc.recordJson(`note/${noteId}`)?.['text'] === 'Hello team', 'no note for the owner')
  })

  await step(
    "owner (admin) edited the invited device's note: ack at head 2, invited device received it",
    async () => {
      const edited = await noteUpdate(ownerDoc, {
        id: noteId,
        text: 'Hello team, edited by the admin',
      })

      ownerDevice.push(region, 1, unwrap(edited))

      const ack = await ownerDevice.next('ack')

      check(ack.batch === 1 && ack.head === 2, `ack of batch ${ack.batch} at head ${ack.head}`)
      check(
        (await takeUpdates(guestDevice, guestDoc, false)) === 2,
        'invited device got no update at head 2',
      )
      check(
        guestDoc.recordJson(`note/${noteId}`)?.['text'] === 'Hello team, edited by the admin',
        'the edit did not reach the invited device',
      )
    },
  )

  const ownerNoteId = noteIdFactory.create()

  await step('owner pushed a note of its own: ack at head 3', async () => {
    const created = await noteCreate(ownerDoc, {
      id: ownerNoteId,
      author: owner.identity.id,
      text: 'From the admin',
    })

    ownerDevice.push(region, 2, unwrap(created))

    const ack = await ownerDevice.next('ack')

    check(ack.batch === 2 && ack.head === 3, `ack of batch ${ack.batch} at head ${ack.head}`)
    check(
      (await takeUpdates(guestDevice, guestDoc, false)) === 3,
      'invited device got no update at head 3',
    )
  })

  await step('invited device deleted its own note: ack at head 4', async () => {
    const deleted = await noteDelete(guestDoc, { id: noteId })

    guestDevice.push(region, 2, unwrap(deleted))

    const ack = await guestDevice.next('ack')

    check(ack.batch === 2 && ack.head === 4, `ack of batch ${ack.batch} at head ${ack.head}`)
  })

  await step(
    "a late device of the owner subscribed: the snapshot at head 4 holds the admin's note only",
    async () => {
      const late = await postCredentials(base, '/auth/sign-in', {
        ...ownerCredentials,
        device: { id: 'smoke-device-late', label: 'Smoke late device' },
      })
      const lateDoc = RegionDoc.inMemory('tenant', region)
      const { device } = await hello(base, opened, late)

      device.subscribe(region)
      check((await takeUpdates(device, lateDoc, true)) === 4, 'the snapshot is not at head 4')
      check(
        lateDoc.recordJson(`note/${ownerNoteId}`)?.['text'] === 'From the admin',
        "the snapshot misses the admin's note",
      )
      check(lateDoc.recordJson(`note/${noteId}`) === undefined, 'the snapshot holds a deleted note')
    },
  )

  await refusedWriteSteps({
    region,
    owner: { signedIn: owner, device: ownerDevice, doc: ownerDoc },
    guest: { signedIn: guest, device: guestDevice, doc: guestDoc },
    ownerNoteId,
  })

  await step('invited device asked for the members: 403 not-admin', async () => {
    const answer = await callAs(base, 'GET', `/organisations/${key}/members`, guest)

    check(
      answer.status === 403 && refusal.safeParse(answer.body).data?.code === 'not-admin',
      `answered ${answer.status} ${JSON.stringify(answer.body)}`,
    )
  })

  await step('the second identity removed: 204', async () => {
    const answer = await callAs(
      base,
      'DELETE',
      `/organisations/${key}/members/${guest.identity.id}`,
      owner,
    )

    check(answer.status === 204, `answered ${answer.status} ${JSON.stringify(answer.body)}`)
  })

  await step(
    `removed device told of no memberships, a pull closes it with ${CLOSE.forbidden}`,
    async () => {
      const told = await guestDevice.next('memberships')

      check(told.memberships.length === 0, `told of ${JSON.stringify(told.memberships)}`)
      guestDevice.send({
        type: 'pull',
        region,
        vv: new Uint8Array(guestDoc.doc.oplogVersion().encode()),
      })

      const refused = await guestDevice.next('error')
      const { code } = await guestDevice.closed

      check(refused.code === 'forbidden-region', `refused with ${refused.code}`)
      check(code === CLOSE.forbidden, `closed with ${code}`)
    },
  )

  await step('the members of the organisation no longer list the second identity', async () => {
    const answer = await callAs(base, 'GET', `/organisations/${key}/members`, owner)

    check(answer.status === 200, `answered ${answer.status} ${JSON.stringify(answer.body)}`)

    const { members } = listedMembers.parse(answer.body)

    check(members.length > 0, 'no members')
    check(
      !members.some((member) => member.identity.id === guest.identity.id),
      'the second identity is still a member',
    )
  })

  await step(`second identity signed out: closed with ${CLOSE.signedOut}`, async () => {
    const { device, welcome } = await hello(base, opened, guest)

    check(welcome.memberships.length === 0, 'the removed identity still belongs')
    device.send({ type: 'sign-out', scope: 'device' })

    const { code } = await device.closed

    check(code === CLOSE.signedOut, `closed with ${code}`)
  })

  // The sign-out ends the grant the invited device signed up with, not only this connection.
  await step(
    `the signed-out identity's refresh key is refused: closed with ${CLOSE.unauthorized}`,
    async () => {
      const { code } = await helloOnRefresh(base, opened, guest)

      check(code === CLOSE.unauthorized, `closed with ${code}`)
    },
  )
}
