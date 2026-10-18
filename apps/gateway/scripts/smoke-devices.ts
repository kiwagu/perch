/**
 * The device session steps of the smoke test: a device bound to its session row, listed, signed
 * out from another device and everywhere.
 */

import { CLOSE, PROTOCOL_VERSION } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { SmokeDevice } from './smoke-device'
import { call, callAs, postCredentials, type SignedIn } from './smoke-http'
import { check, hello, type Opened, refusal, step } from './smoke-steps'

/** A device as `GET /devices` lists it, as far as the smoke reads it. */
const listedDevices = z.object({
  devices: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      revokedAt: z.string().nullable(),
      current: z.boolean(),
    }),
  ),
})

function unreachableRoot(): never {
  throw new Error('the gateway root is not open')
}

/** Says hello as `signedIn` from its device and waits for the socket to close: its close. */
async function refusedHello(base: string, opened: Opened, signedIn: SignedIn) {
  const device = await SmokeDevice.open(`${base.replace(/^http/, 'ws')}/sync`)

  opened.devices.push(device)
  device.send({
    type: 'hello',
    protocol: PROTOCOL_VERSION,
    ...signedIn.tokens,
    device: signedIn.device,
  })

  return device.closed
}

/** The caller's devices as `GET /devices` lists them to `signedIn`, from its own device. */
async function devicesOf(base: string, signedIn: SignedIn) {
  const answer = await callAs(base, 'GET', '/devices', signedIn)

  check(answer.status === 200, `answered ${answer.status} ${JSON.stringify(answer.body)}`)

  return listedDevices.parse(answer.body).devices
}

/**
 * Device sessions, on a fresh identity with a laptop and a phone: a hello under a device with no
 * session refused (4401) and a call that names no device refused (400); both devices listed, the
 * laptop as the current one; the phone signed out from the laptop (its socket closed with 4001,
 * its row revoked, its hello with its still working access token closed with 4001); then a
 * tablet signed in twice (the grant of its first sign-in revoked by the second) and every device
 * signed out from the laptop (the laptop's and the tablet's
 * sockets closed with 4001), after which the laptop's old pair is refused at hello and by the
 * sign-out route.
 */
export async function deviceSessionSteps(base: string, opened: Opened): Promise<void> {
  const credentials = {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: crypto.randomUUID(),
  }
  const { laptop, phone } = await step(
    'devices: signed up on a laptop, signed in on a phone',
    async () => ({
      laptop: await postCredentials(base, '/auth/sign-up', {
        ...credentials,
        device: { id: 'smoke-laptop', label: 'Smoke laptop' },
      }),
      phone: await postCredentials(base, '/auth/sign-in', {
        ...credentials,
        device: { id: 'smoke-phone', label: 'Smoke phone' },
      }),
    }),
  )
  const sockets = await step('devices: laptop and phone welcomed', async () => ({
    laptop: (await hello(base, opened, laptop)).device,
    phone: (await hello(base, opened, phone)).device,
  }))

  await step(
    `a hello under a device with no session: closed with ${CLOSE.unauthorized}`,
    async () => {
      const { code } = await refusedHello(base, opened, { ...laptop, device: 'smoke-unlisted' })

      check(code === CLOSE.unauthorized, `closed with ${code}`)
    },
  )

  await step('a call without X-Perch-Device: 400', async () => {
    const answer = await call(base, 'GET', '/devices', laptop.tokens.access)

    check(
      answer.status === 400 && refusal.safeParse(answer.body).data?.code === 'bad-request',
      `answered ${answer.status} ${JSON.stringify(answer.body)}`,
    )
  })

  const phoneRow = await step('GET /devices lists both, the laptop as current', async () => {
    const devices = await devicesOf(base, laptop)

    check(
      devices.map((device) => device.label).join() === 'Smoke laptop,Smoke phone',
      `listed ${JSON.stringify(devices)}`,
    )
    check(
      !JSON.stringify(devices).includes('smoke-phone'),
      "the list gives away the phone's device id",
    )
    check(
      devices.map((device) => device.current).join() === 'true,false',
      `current ${JSON.stringify(devices)}`,
    )

    const [, listedPhone] = devices

    if (!listedPhone) {
      throw new Error('the phone is not listed')
    }

    return listedPhone
  })

  await step(
    `phone signed out by DELETE /devices/<phone>: 204, closed with ${CLOSE.revoked}`,
    async () => {
      const answer = await callAs(base, 'DELETE', `/devices/${phoneRow.id}`, laptop)

      check(answer.status === 204, `answered ${answer.status} ${JSON.stringify(answer.body)}`)

      const { code } = await sockets.phone.closed
      const revoked = (await devicesOf(base, laptop)).find((device) => device.id === phoneRow.id)

      check(code === CLOSE.revoked, `closed with ${code}`)
      check(revoked !== undefined, 'the phone is no longer listed')
      check(typeof revoked?.revokedAt === 'string', 'the phone is not marked revoked')
    },
  )

  await step(
    `the signed-out phone's hello with its working access token: closed with ${CLOSE.revoked}`,
    async () => {
      const { code } = await refusedHello(base, opened, phone)

      check(code === CLOSE.revoked, `closed with ${code}`)
    },
  )

  const tablet = await step(
    'devices: signed in twice on a tablet, the first grant revoked, the second welcomed',
    async () => {
      const signIn = () =>
        postCredentials(base, '/auth/sign-in', {
          ...credentials,
          device: { id: 'smoke-tablet', label: 'Smoke tablet' },
        })
      const first = await signIn()
      const second = await signIn()
      const sessions = opened.root?.sessions ?? unreachableRoot()
      const renewed = await sessions.authenticate({
        access: 'stale',
        refresh: first.tokens.refresh,
      })

      check(renewed.isErr(), "the tablet's first refresh key still renews")

      return (await hello(base, opened, second)).device
    },
  )

  await step(
    `POST /auth/sign-out-everywhere: 204, laptop and tablet closed with ${CLOSE.revoked}`,
    async () => {
      const answer = await callAs(base, 'POST', '/auth/sign-out-everywhere', laptop)

      check(answer.status === 204, `answered ${answer.status} ${JSON.stringify(answer.body)}`)

      const codes = [(await sockets.laptop.closed).code, (await tablet.closed).code]

      check(
        codes.every((code) => code === CLOSE.revoked),
        `closed with ${codes.join()}`,
      )
    },
  )

  await step(`hello with the laptop's old pair: closed with ${CLOSE.unauthorized}`, async () => {
    const { code } = await refusedHello(base, opened, laptop)

    check(code === CLOSE.unauthorized, `closed with ${code}`)
  })

  await step('POST /auth/sign-out with the dead pair: 401', async () => {
    const answer = await call(
      base,
      'POST',
      '/auth/sign-out',
      undefined,
      { access: laptop.tokens.access, refresh: laptop.tokens.refresh },
      laptop.device,
    )

    check(
      answer.status === 401 && refusal.safeParse(answer.body).data?.code === 'unauthorized',
      `answered ${answer.status} ${JSON.stringify(answer.body)}`,
    )
  })
}
