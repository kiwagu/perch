/**
 * The device session steps of the smoke test: a device bound to its session, listed, signed out
 * from another device and everywhere, and signing itself out with its own token.
 */

import type { Mailbox } from '@workspace/mailbox'
import { CLOSE } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { type Answer, call, callAs, postCredentials, type SignedIn, signUp } from './http'
import { reported } from './reported-answer'
import { check, hello, type Opened, refusal, refusedHello, step } from './steps'

/**
 * The devices as `GET /devices` lists them, every field of each named: a field the list must not
 * send (a device's own id, its session token) fails the parse instead of being dropped by it.
 */
const listedDevices = z.strictObject({
  devices: z.array(
    z.strictObject({
      id: z.string(),
      label: z.string(),
      createdAt: z.iso.datetime(),
      lastSeenAt: z.iso.datetime(),
      revokedAt: z.iso.datetime().nullable(),
      current: z.boolean(),
    }),
  ),
})

/**
 * The caller's devices as `GET /devices` lists them to `signedIn`, from its own device, and the
 * answer's body as it came.
 */
async function listOf(base: string, signedIn: SignedIn) {
  const answer = await callAs(base, 'GET', '/devices', signedIn)

  check(answer.status === 200, `answered ${reported(answer)}`)

  return { devices: listedDevices.parse(answer.body).devices, raw: JSON.stringify(answer.body) }
}

/** The caller's devices as `GET /devices` lists them to `signedIn`, from its own device. */
async function devicesOf(base: string, signedIn: SignedIn) {
  return (await listOf(base, signedIn)).devices
}

/** Whether a call answered 401 `unauthorized`: the token holds no live session of its device. */
function refused(answer: Answer): boolean {
  return answer.status === 401 && refusal.safeParse(answer.body).data?.code === 'unauthorized'
}

/** `POST /auth/sign-out` with `token` as the Bearer token, from `device`, with no body. */
function signOut(base: string, token: string, device: string): Promise<Answer> {
  return call(base, 'POST', '/auth/sign-out', token, undefined, device)
}

/**
 * Device sessions, on a fresh identity verified on a laptop and signed in on a phone: a hello under a device with no
 * session refused (4401) and a call that names no device refused (400); both devices listed, the
 * laptop as the current one; the phone signed out from the laptop (its socket closed with 4001,
 * its row showing when its session ended, its token's hello closed with 4401), then signed in
 * again (its old token refused at hello and on a call, its new token welcomed); a tablet signed
 * in twice (the first session ended by the second); every device signed out from the laptop
 * (every socket closed with 4001, every token refused); a sign-in right after it works, the
 * laptop's old token is refused at hello, and a device signs itself out with its own token
 * (204, again 204, a made-up token 401).
 */
export async function deviceSessionSteps(
  base: string,
  mailbox: Mailbox,
  opened: Opened,
): Promise<void> {
  const credentials = {
    email: `smoke-${crypto.randomUUID()}@example.test`,
    password: crypto.randomUUID(),
  }
  const signIn = (id: string, label: string) =>
    postCredentials(base, '/auth/sign-in/email', { ...credentials, device: { id, label } })
  const { laptop, phone } = await step(
    'devices: signed up and verified on a laptop, signed in on a phone',
    async () => ({
      laptop: await signUp(base, mailbox, {
        ...credentials,
        device: { id: 'smoke-laptop', label: 'Smoke laptop' },
      }),
      phone: await signIn('smoke-phone', 'Smoke phone'),
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
    const answer = await call(base, 'GET', '/devices', laptop.token)

    check(
      answer.status === 400 && refusal.safeParse(answer.body).data?.code === 'bad-request',
      `answered ${reported(answer)}`,
    )
  })

  const phoneRow = await step('GET /devices lists both, the laptop as current', async () => {
    const { devices, raw } = await listOf(base, laptop)

    check(
      devices.map((device) => device.label).join() === 'Smoke laptop,Smoke phone',
      `listed ${JSON.stringify(devices)}`,
    )
    check(!raw.includes('smoke-phone'), "the list gives away the phone's device id")
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
    `phone signed out by DELETE /devices/<phone>: 204, closed with ${CLOSE.revoked}, its row ended`,
    async () => {
      const answer = await callAs(base, 'DELETE', `/devices/${phoneRow.id}`, laptop)

      check(answer.status === 204, `answered ${reported(answer)}`)

      const { code } = await sockets.phone.closed
      const ended = (await devicesOf(base, laptop)).find((device) => device.id === phoneRow.id)

      check(code === CLOSE.revoked, `closed with ${code}`)
      check(ended !== undefined, 'the phone is no longer listed')
      check(typeof ended?.revokedAt === 'string', 'the phone shows no revokedAt')
    },
  )

  await step(
    `the signed-out phone's hello with its token: closed with ${CLOSE.unauthorized}`,
    async () => {
      const { code } = await refusedHello(base, opened, phone)

      check(code === CLOSE.unauthorized, `closed with ${code}`)
    },
  )

  const phoneAgain = await step(
    `the phone signed in again: its old token refused at hello (${CLOSE.unauthorized}) and on a call (401), its new token welcomed`,
    async () => {
      const again = await signIn('smoke-phone', 'Smoke phone')
      const { code } = await refusedHello(base, opened, phone)
      const old = await callAs(base, 'GET', '/devices', phone)

      check(code === CLOSE.unauthorized, `the old token's hello closed with ${code}`)
      check(refused(old), `the old token answered ${reported(old)}`)

      const { device } = await hello(base, opened, again)
      const fresh = await callAs(base, 'GET', '/devices', again)

      check(fresh.status === 200, `the new token answered ${fresh.status}`)

      return { signedIn: again, socket: device }
    },
  )

  const tablet = await step(
    'devices: signed in twice on a tablet, the first session ended by the second, the second welcomed',
    async () => {
      const first = await signIn('smoke-tablet', 'Smoke tablet')
      const second = await signIn('smoke-tablet', 'Smoke tablet')
      const stale = await callAs(base, 'GET', '/devices', first)

      check(refused(stale), `the first token answered ${reported(stale)}`)

      return { signedIn: second, socket: (await hello(base, opened, second)).device }
    },
  )

  await step(
    `POST /auth/sign-out-everywhere: 204, every socket closed with ${CLOSE.revoked}, every token refused`,
    async () => {
      const answer = await callAs(base, 'POST', '/auth/sign-out-everywhere', laptop)

      check(answer.status === 204, `answered ${reported(answer)}`)

      const codes = await Promise.all(
        [sockets.laptop, phoneAgain.socket, tablet.socket].map(
          async (socket) => (await socket.closed).code,
        ),
      )

      check(
        codes.every((code) => code === CLOSE.revoked),
        `closed with ${codes.join()}`,
      )

      for (const signedIn of [laptop, phoneAgain.signedIn, tablet.signedIn]) {
        const after = await callAs(base, 'GET', '/devices', signedIn)

        check(refused(after), `${signedIn.device}'s token answered ${after.status}`)
      }
    },
  )

  const desktop = await step(
    'a sign-in right after the sign-out everywhere: 200, its token accepted',
    async () => {
      const signedIn = await signIn('smoke-desktop', 'Smoke desktop')
      const current = (await devicesOf(base, signedIn)).filter((device) => device.current)

      check(current.length === 1, `current ${JSON.stringify(current)}`)

      return signedIn
    },
  )

  await step(`hello with the laptop's old token: closed with ${CLOSE.unauthorized}`, async () => {
    const { code } = await refusedHello(base, opened, laptop)

    check(code === CLOSE.unauthorized, `closed with ${code}`)
  })

  await step(
    `POST /auth/sign-out with the desktop's token: 204, its socket closed with ${CLOSE.revoked}`,
    async () => {
      const { device } = await hello(base, opened, desktop)
      const answer = await signOut(base, desktop.token, desktop.device)
      const { code } = await device.closed

      check(answer.status === 204, `answered ${reported(answer)}`)
      check(code === CLOSE.revoked, `closed with ${code}`)
    },
  )

  await step('POST /auth/sign-out with the same token again: 204', async () => {
    const answer = await signOut(base, desktop.token, desktop.device)

    check(answer.status === 204, `answered ${reported(answer)}`)
  })

  await step('POST /auth/sign-out with a made-up token: 401', async () => {
    const answer = await signOut(base, crypto.randomUUID(), desktop.device)

    check(refused(answer), `answered ${reported(answer)}`)
  })
}
