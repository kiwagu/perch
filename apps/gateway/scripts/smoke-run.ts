/**
 * The smoke test behind `smoke.ts`: the gateway runs in this process in front of a SurrealDB
 * stand and serves a new identity's two devices over HTTP and WebSocket, through sign-up,
 * sign-in, push, fan-out and sign-out. It prints one line per step and stops at the first
 * step that fails or takes longer than 5 s. The identity it signs up stays on the stand, for
 * the sweep of `@example.test` accounts.
 */

import { remoteEngines, wsRpcUrl } from '@workspace/data/engines/remote'
import { noteIdFactory, profileIdFactory } from '@workspace/ids'
import { RegionDoc, systemClock } from '@workspace/replica'
import { CLOSE, type Membership, membership, PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import revokeGrantsStatement from '../src/auth/surql/grants-revoke-all.surql'
import sessionsRevokedStatement from '../src/auth/surql/identity-sessions-revoked.surql'
import { createGatewayRoot, type GatewayRoot } from '../src/composition/root'
import { gatewayConfig, httpRpcUrl } from '../src/config'
import { startServer } from '../src/server'
import { noteCreate, noteDelete, noteUpdate } from '../src/sync/__fixtures__/note'
import { profileCreate, profileRename } from '../src/sync/__fixtures__/profile'

import { SmokeDevice } from './smoke-device'
import { deviceSessionSteps } from './smoke-devices'
import { callAs, postCredentials, type SignedIn } from './smoke-http'
import { check, hello, type Opened, refusal, step, unwrap } from './smoke-steps'

/** The gateway user the stand operator defines on a local stand, for what env leaves out. */
const STAND_USER = {
  username: 'gateway',
  password: 'gateway-stand-password',
} as const

const smokeConfig = gatewayConfig.pick({
  SURREAL_URL: true,
  GATEWAY_SURREAL_USER: true,
  GATEWAY_SURREAL_PASS: true,
})

type SmokeConfig = z.output<typeof smokeConfig>

async function welcomed(
  base: string,
  opened: Opened,
  signedIn: SignedIn,
  head: number,
): Promise<SmokeDevice> {
  const { device, welcome } = await hello(base, opened, signedIn)
  const { identity } = signedIn
  const region = `identity:${identity.id}`

  check(
    JSON.stringify(welcome.regions) === JSON.stringify([{ region, head }]),
    `welcomed with ${JSON.stringify(welcome.regions)}`,
  )

  return device
}

/** Takes the device's next `updates` into its document; answers with the update's head. */
async function takeUpdates(device: SmokeDevice, doc: RegionDoc, snapshot: boolean) {
  const updates = await device.next('updates')

  check(updates.snapshot === snapshot, `updates with snapshot ${updates.snapshot}`)
  unwrap(await doc.importRemote(updates.bytes, updates.head))

  return updates.head
}

const createdOrganisation = z.object({ membership: membership })

const listedMembers = z.object({
  members: z.array(z.object({ identity: z.object({ id: z.string() }) })),
})

/** Whether a welcome's regions name `region`. */
function hasRegion(regions: readonly { readonly region: string }[], region: string): boolean {
  return regions.some((entry) => entry.region === region)
}

function keysOf(memberships: readonly Membership[]): string[] {
  return memberships.map((entry) => entry.tenant.key)
}

/**
 * The organisation path: `owner` creates an organisation and invites a second identity into
 * it, whose device writes into the organisation's region, is refused a note in another
 * member's name, and is removed. The organisation and the second identity stay on the stand,
 * for the sweep of `@example.test` accounts.
 */
async function organisationSteps(base: string, opened: Opened, owner: SignedIn): Promise<void> {
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
        keysOf(welcome.memberships).join() === key,
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

  await step("invited device edited the owner's note: rejected as forbidden-action", async () => {
    const edited = await noteUpdate(guestDoc, { id: ownerNoteId, text: 'Not mine' })

    guestDevice.push(region, 3, unwrap(edited))

    const rejected = await guestDevice.next('reject')

    check(
      rejected.batch === 3 &&
        rejected.reason === 'forbidden-action' &&
        rejected.detail === `note/${ownerNoteId}:update`,
      `rejected batch ${rejected.batch} for ${rejected.reason} (${rejected.detail})`,
    )
  })

  await step('invited device asked for the members: 403 not-admin', async () => {
    const answer = await callAs(base, 'GET', `/organisations/${key}/members`, guest)

    check(
      answer.status === 403 && refusal.safeParse(answer.body).data?.code === 'not-admin',
      `answered ${answer.status} ${JSON.stringify(answer.body)}`,
    )
  })

  await step("a note in the owner's name is rejected: foreign-owner", async () => {
    // From a document of its own: the guest's one holds its refused edit, which the server lacks.
    const forged = await noteCreate(RegionDoc.inMemory('tenant', region), {
      id: noteIdFactory.create(),
      author: owner.identity.id,
      text: 'Forged',
    })

    guestDevice.push(region, 4, unwrap(forged))

    const rejected = await guestDevice.next('reject')

    check(
      rejected.batch === 4 && rejected.reason === 'foreign-owner',
      `rejected batch ${rejected.batch} for ${rejected.reason}`,
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
}

/**
 * The clause of the access method, on a fresh identity: its fresh token is accepted, the same
 * token issued before `sessions_revoked_at` is refused, a refresh is not (its exchange carries
 * no token), and the gateway's namespace user revokes the identity's grants, which refuses the
 * refresh.
 */
async function sessionsRevokedSteps(base: string, root: GatewayRoot): Promise<void> {
  const signedUp = await postCredentials(base, '/auth/sign-up', {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: crypto.randomUUID(),
    device: { id: 'smoke-device', label: 'Smoke' },
  })
  const { access, refresh } = signedUp.tokens
  const identity = signedUp.identity.id

  // The same token through the same calls: only the mark explains the refusal that follows.
  await step('a fresh token is accepted before sessions_revoked_at', async () => {
    const accepted = unwrap(await root.sessions.authenticate({ access }))

    check(accepted.renewed === false, 'the token was renewed')
  })

  await step('sessions_revoked_at set by the namespace user', async () => {
    await root.local.db.query(sessionsRevokedStatement, {
      identity,
      at: new Date(Date.now() + 5_000),
    })
  })

  await step('a token issued before sessions_revoked_at is refused', async () => {
    const refused = await root.sessions.authenticate({ access })

    check(refused.isErr(), 'the token was accepted')
  })

  const renewed = await step('a refresh is not blocked by the clause', async () => {
    const answer = unwrap(await root.sessions.authenticate({ access, refresh }))

    if (!answer.renewed) {
      throw new Error('the pair was not renewed')
    }

    return answer.tokens
  })

  await step(
    "the namespace user revokes the identity's grants: the refresh is refused",
    async () => {
      await root.local.db.query(revokeGrantsStatement, { identity })

      const refused = await root.sessions.authenticate(renewed)

      check(refused.isErr(), 'the refresh was accepted')
    },
  )
}

async function steps(config: SmokeConfig, opened: Opened): Promise<void> {
  const root = await step(`gateway opened ${config.SURREAL_URL}`, async () =>
    unwrap(
      await createGatewayRoot({
        engines: remoteEngines(),
        url: config.SURREAL_URL,
        credentials: {
          username: config.GATEWAY_SURREAL_USER,
          password: config.GATEWAY_SURREAL_PASS,
        },
        rpcUrl: httpRpcUrl(config.SURREAL_URL),
        clock: systemClock,
      }),
    ),
  )

  opened.root = root

  const server = await step('gateway listening', async () =>
    startServer(root, { port: 0, hostname: '127.0.0.1' }),
  )

  opened.server = server

  const base = `http://127.0.0.1:${server.port}`
  const credentials = {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: crypto.randomUUID(),
  }
  const first = await step(`signed up ${credentials.email}`, () =>
    postCredentials(base, '/auth/sign-up', {
      ...credentials,
      device: { id: 'smoke-device-1', label: 'Smoke device 1' },
    }),
  )
  const second = await step('signed in a second device', () =>
    postCredentials(base, '/auth/sign-in', {
      ...credentials,
      device: { id: 'smoke-device-2', label: 'Smoke device 2' },
    }),
  )
  const region = `identity:${first.identity.id}`
  const profileId = profileIdFactory.create()
  const doc1 = RegionDoc.inMemory('private', region)
  const doc2 = RegionDoc.inMemory('private', region)

  const device1 = await step('device 1 welcomed at head 0', () => welcomed(base, opened, first, 0))

  await step('device 1 subscribed: an empty snapshot', async () => {
    device1.send({ type: 'subscribe', region, vv: null })
    check((await takeUpdates(device1, doc1, true)) === 0, 'the snapshot is not at head 0')
  })

  await step('device 1 pushed its profile: ack at head 1', async () => {
    const created = await profileCreate(doc1, {
      id: profileId,
      identity: first.identity.id,
      name: 'Smoke',
      email: credentials.email,
    })

    device1.send({ type: 'push', region, batch: 1, updates: [unwrap(created)] })

    const ack = await device1.next('ack')

    check(ack.batch === 1 && ack.head === 1, `ack of batch ${ack.batch} at head ${ack.head}`)
  })

  const device2 = await step('device 2 welcomed at head 1', () => welcomed(base, opened, second, 1))

  await step('device 2 subscribed: the snapshot holds the profile', async () => {
    device2.send({ type: 'subscribe', region, vv: null })
    check((await takeUpdates(device2, doc2, true)) === 1, 'the snapshot is not at head 1')
    check(doc2.recordJson(`profile/${profileId}`)?.['name'] === 'Smoke', 'no profile named Smoke')
  })

  await step('device 1 renamed the profile: ack at head 2, device 2 received it', async () => {
    const renamed = await profileRename(doc1, profileId, 'Smoke renamed')

    device1.send({ type: 'push', region, batch: 2, updates: [unwrap(renamed)] })

    const ack = await device1.next('ack')

    check(ack.batch === 2 && ack.head === 2, `ack of batch ${ack.batch} at head ${ack.head}`)
    check((await takeUpdates(device2, doc2, false)) === 2, 'device 2 got no update at head 2')
    check(
      doc2.recordJson(`profile/${profileId}`)?.['name'] === 'Smoke renamed',
      'device 2 does not see the new name',
    )
  })

  await step(`device 1 signed out: closed with ${CLOSE.signedOut}`, async () => {
    device1.send({ type: 'sign-out', scope: 'device' })

    const { code } = await device1.closed

    check(code === CLOSE.signedOut, `closed with ${code}`)
  })

  await step(`the revoked refresh key is refused: closed with ${CLOSE.unauthorized}`, async () => {
    const device3 = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

    opened.devices.push(device3)
    device3.send({
      type: 'hello',
      protocol: PROTOCOL_VERSION,
      access: 'not-a-token',
      refresh: first.tokens.refresh,
      device: first.device,
    })

    const { code } = await device3.closed

    check(code === CLOSE.unauthorized, `closed with ${code}`)
  })

  await sessionsRevokedSteps(base, root)
  await deviceSessionSteps(base, opened)
  await organisationSteps(base, opened, second)
}

/** Runs the smoke test; resolves to the process's exit code. */
export async function runSmoke(env: Readonly<Record<string, string | undefined>>): Promise<number> {
  // The stand's address comes from `bun run test:db`, which runs the smoke through `mcproc
  // exec` with SURREAL_URL from the manifest; an http(s) address, as the database suites take
  // it, becomes the WebSocket endpoint.
  const url = env['SURREAL_URL']
  const parsed = smokeConfig.safeParse({
    SURREAL_URL: url !== undefined && URL.canParse(url) ? wsRpcUrl(url) : url,
    GATEWAY_SURREAL_USER: env['GATEWAY_SURREAL_USER'] ?? STAND_USER.username,
    GATEWAY_SURREAL_PASS: env['GATEWAY_SURREAL_PASS'] ?? STAND_USER.password,
  })

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      console.error(`smoke: ${issue.path.join('.')}: ${issue.message}`)
    }

    return 1
  }

  const opened: Opened = { devices: [] }
  const passed = await steps(parsed.data, opened).then(
    () => true,
    () => false,
  )

  const stopped = await step('gateway stopped', async () => {
    for (const device of opened.devices) {
      device.close()
    }

    await opened.server?.stop()
    await opened.root?.close()
  }).then(
    () => true,
    () => false,
  )

  console.log(passed && stopped ? 'smoke: passed' : 'smoke: failed')

  return passed && stopped ? 0 : 1
}
