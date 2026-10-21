/**
 * The smoke test behind `cli.ts`: the gateway runs in this process in front of a SurrealDB
 * stand and serves a new identity's two devices over HTTP and WebSocket, through sign-up,
 * sign-in, push, fan-out and sign-out. It prints one line per step and stops at the first
 * step that fails or takes longer than 5 s. The identity it signs up stays on the stand, for
 * the sweep of `@example.test` accounts.
 */

import { remoteEngines, wsRpcUrl } from '@workspace/data/engines/remote'
import { profileIdFactory } from '@workspace/ids'
import { RegionDoc, systemClock } from '@workspace/replica'
import { CLOSE, PROTOCOL_VERSION } from '@workspace/replica/protocol'
import type { z } from '@workspace/zod'

import { createGatewayRoot } from '../../src/composition/root'
import { gatewayConfig } from '../../src/config'
import { startServer } from '../../src/server'
import { profileCreate, profileRename } from '../../src/sync/__fixtures__/profile'

import { accessSteps } from './access'
import { SmokeDevice } from './device'
import { deviceSessionSteps } from './device-sessions'
import { postCredentials, type SignedIn } from './http'
import { organisationSteps } from './organisation'
import { check, hello, type Opened, step, takeUpdates, unwrap } from './steps'

/** The gateway user the stand operator defines on a local stand, for what env leaves out. */
const STAND_USER = {
  username: 'gateway',
  password: 'gateway-stand-password',
} as const

const smokeConfig = gatewayConfig.pick({
  SURREAL_URL: true,
  GATEWAY_SURREAL_USER: true,
  GATEWAY_SURREAL_PASS: true,
  GATEWAY_JWT_KEY: true,
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
        signingKey: config.GATEWAY_JWT_KEY,
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

  await accessSteps(base, root, config.GATEWAY_JWT_KEY, opened)
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
    // No default: the smoke opens the stand's directory with the key its gateway signs with.
    GATEWAY_JWT_KEY: env['GATEWAY_JWT_KEY'],
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
