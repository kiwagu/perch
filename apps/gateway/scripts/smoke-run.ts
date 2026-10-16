/**
 * The smoke test behind `smoke.ts`: the gateway runs in this process in front of a SurrealDB
 * stand and serves a new identity's two devices over HTTP and WebSocket, through sign-up,
 * sign-in, push, fan-out and sign-out. It prints one line per step and stops at the first
 * step that fails or takes longer than 5 s. The identity it signs up stays on the stand, for
 * the sweep of `@example.test` accounts.
 */

import type { Result } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { remoteEngines } from '@workspace/data/engines/remote'
import { profileIdFactory } from '@workspace/ids'
import { RegionDoc, systemClock } from '@workspace/replica'
import { CLOSE, PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { createGatewayRoot, type GatewayRoot } from '../src/composition/root'
import { gatewayConfig, httpRpcUrl } from '../src/config'
import { type RunningServer, startServer } from '../src/server'
import { profileCreate, profileRename } from '../src/sync/__fixtures__/profile'

import { SmokeDevice } from './smoke-device'

/** The e2e stand's WebSocket endpoint, used when `SURREAL_URL` is not set. */
const E2E_STAND = 'ws://127.0.0.1:8010/rpc'

const STEP_TIMEOUT_MS = 5_000

const smokeConfig = gatewayConfig.pick({
  SURREAL_URL: true,
  GATEWAY_SURREAL_USER: true,
  GATEWAY_SURREAL_PASS: true,
})

type SmokeConfig = z.output<typeof smokeConfig>

const signedIn = z.object({
  identity: z.object({ id: z.string(), email: z.string() }),
  tokens: z.object({ access: z.string(), refresh: z.string() }),
})

type SignedIn = z.output<typeof signedIn>

/** What the run opened, to close at its end whatever happened. */
interface Opened {
  root?: GatewayRoot
  server?: RunningServer
  readonly devices: SmokeDevice[]
}

function check(condition: boolean, failure: string): void {
  if (!condition) {
    throw new Error(failure)
  }
}

function unwrap<T>(result: Result<T, DataError>): T {
  return result.match(
    (value) => value,
    (error) => {
      throw new Error(`${error.code} ${error.message}`)
    },
  )
}

function within<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${STEP_TIMEOUT_MS / 1000} s`)),
      STEP_TIMEOUT_MS,
    )
  })

  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

/** Runs one step within the step time and prints whether it passed; a failure ends the run. */
async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  try {
    const value = await within(run())

    console.log(`smoke: ok   ${name}`)

    return value
  } catch (cause) {
    console.log(`smoke: FAIL ${name}: ${cause instanceof Error ? cause.message : String(cause)}`)

    throw cause
  }
}

async function postCredentials(
  base: string,
  path: string,
  credentials: { readonly email: string; readonly password: string },
): Promise<SignedIn> {
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  })
  const body: unknown = await response.json()

  check(response.ok, `${path} answered ${response.status} ${JSON.stringify(body)}`)

  return signedIn.parse(body)
}

async function welcomed(
  base: string,
  opened: Opened,
  { identity, tokens }: SignedIn,
  head: number,
): Promise<SmokeDevice> {
  const device = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

  opened.devices.push(device)
  device.send({ type: 'hello', protocol: PROTOCOL_VERSION, ...tokens })

  const welcome = await device.next('welcome')
  const region = `identity:${identity.id}`

  check(welcome.identity === identity.id, `welcomed as ${welcome.identity}`)
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
    postCredentials(base, '/auth/sign-up', credentials),
  )
  const second = await step('signed in a second device', () =>
    postCredentials(base, '/auth/sign-in', credentials),
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
    })

    const { code } = await device3.closed

    check(code === CLOSE.unauthorized, `closed with ${code}`)
  })
}

/** Runs the smoke test; resolves to the process's exit code. */
export async function runSmoke(env: Readonly<Record<string, string | undefined>>): Promise<number> {
  const parsed = smokeConfig.safeParse({ ...env, SURREAL_URL: env['SURREAL_URL'] ?? E2E_STAND })

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
