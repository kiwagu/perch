import { afterEach, describe, expect, it, vi } from 'vitest'

import { passkeyIdFactory } from '@workspace/ids'

import { challengeValue } from './auth-handler'
import { ANN, mountedOnRealAuth, signedInOn } from './auth-handler/__fixtures__/mount'
import { authenticator, passkeysOf, registrationsOf } from './auth-handler/__fixtures__/passkey'

/** A second account, whose passkeys are not Ann's. */
const BOB = 'bob@example.test'

const DAY_MS = 24 * 60 * 60 * 1000

/** How long a test of several sign-ups may run: each is an argon2 run, slow on a busy host. */
const ARGON2_RUNS_MS = 60_000

const failed = (status: number) => ({ status, body: { code: 'failed' } })

afterEach(() => {
  vi.useRealTimers()
})

describe('passkeyRoutes, the registration of a passkey', () => {
  it(
    "answers the options of a registration with a discoverable credential that verifies its user, and the challenge as one cookie's value",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const response = await passkeys.route(
        passkeys.request('POST', '/passkeys/options', ann.on('laptop')),
        '198.18.9.1',
      )

      expect(response?.status).toBe(200)
      expect(response?.headers.getSetCookie()).toEqual([])
      expect(response?.headers.get('set-auth-token')).toBeNull()

      const { options, challenge } = await passkeys.started(ann.on('laptop'))

      expect(options['authenticatorSelection']).toEqual({
        residentKey: 'required',
        userVerification: 'required',
        requireResidentKey: true,
      })
      expect(options['rp']).toEqual({ name: 'Perch', id: 'localhost' })
      expect(challengeValue.safeParse(challenge).success).toBe(true)
      expect((await registrationsOf(mounted, ann.identity)).registrations).toHaveLength(2)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'adds a passkey made with the options and lists it with when it was added',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const before = Date.now()
      const body = await passkeys.made(ann.on('laptop'), authenticator())

      expect(await passkeys.add(ann.on('laptop'), body)).toEqual({ status: 201, body: undefined })

      const [added, ...others] = await passkeys.listed(ann.on('laptop'))

      expect(others).toEqual([])
      expect(added?.id).toMatch(/^pkey_/)
      expect(Date.parse(added?.createdAt ?? '')).toBeGreaterThanOrEqual(before - 1_000)
      expect((await registrationsOf(mounted, ann.identity)).passkeys).toEqual([added?.id])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'adds a passkey from a device whose session is two days old',
    async () => {
      const mounted = await mountedOnRealAuth()

      // The device signed in two days ago: only the clock Better Auth stamps a session with moves.
      vi.useFakeTimers({ toFake: ['Date'], now: Date.now() - 2 * DAY_MS })

      const ann = await signedInOn(mounted, ANN, ['laptop'])

      vi.useRealTimers()

      const passkeys = passkeysOf(mounted)
      const body = await passkeys.made(ann.on('laptop'), authenticator())

      expect((await passkeys.add(ann.on('laptop'), body)).status).toBe(201)
      expect(await passkeys.listed(ann.on('laptop'))).toHaveLength(1)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'refuses 400 failed a passkey whose authenticator did not verify its user, keeping nothing',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const body = await passkeys.made(ann.on('laptop'), authenticator(), { userVerified: false })

      expect(await passkeys.add(ann.on('laptop'), body)).toEqual(failed(400))
      expect(await passkeys.listed(ann.on('laptop'))).toEqual([])
      expect((await registrationsOf(mounted, ann.identity)).passkeys).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "refuses 400 failed a registration whose challenge another account's options made, keeping nothing",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const bob = await signedInOn(mounted, BOB, ['phone'])
      const passkeys = passkeysOf(mounted)
      const body = await passkeys.made(bob.on('phone'), authenticator())

      expect(await passkeys.add(ann.on('laptop'), body)).toEqual(failed(400))
      expect((await registrationsOf(mounted, ann.identity)).passkeys).toEqual([])
      expect((await registrationsOf(mounted, bob.identity)).passkeys).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'refuses 400 bad-request an add that names no challenge of the cookie form, before Better Auth is asked',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const { response } = await passkeys.made(ann.on('laptop'), authenticator())

      expect(
        await passkeys.add(ann.on('laptop'), {
          response,
          challenge: 'forged; better-auth.session_token=x',
        }),
      ).toEqual({ status: 400, body: { code: 'bad-request' } })
      expect(await passkeys.add(ann.on('laptop'), { challenge: 'abc' })).toEqual({
        status: 400,
        body: { code: 'bad-request' },
      })
      expect(await passkeys.listed(ann.on('laptop'))).toEqual([])
    },
    ARGON2_RUNS_MS,
  )
})

describe('passkeyRoutes, the list and the removal of passkeys', () => {
  it(
    "lists the account's passkeys the earliest added first, and no other account's",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const bob = await signedInOn(mounted, BOB, ['phone'])
      const passkeys = passkeysOf(mounted)
      const first = await passkeys.registered(ann.on('laptop'), authenticator())

      await passkeys.registered(bob.on('phone'), authenticator())

      const second = await passkeys.registered(ann.on('laptop'), authenticator())

      expect((await passkeys.listed(ann.on('laptop'))).map(({ id }) => id)).toEqual([first, second])
      expect(await passkeys.listed(bob.on('phone'))).toHaveLength(1)
    },
    ARGON2_RUNS_MS,
  )

  it(
    'removes a passkey of the account, after which the list is empty',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const id = await passkeys.registered(ann.on('laptop'), authenticator())

      expect(await passkeys.remove(ann.on('laptop'), id)).toEqual({ status: 204, body: undefined })
      expect(await passkeys.listed(ann.on('laptop'))).toEqual([])
      expect((await registrationsOf(mounted, ann.identity)).passkeys).toEqual([])
    },
    ARGON2_RUNS_MS,
  )

  it(
    "answers 404 failed to the removal of another account's passkey, which stays, and of an unknown one",
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const bob = await signedInOn(mounted, BOB, ['phone'])
      const passkeys = passkeysOf(mounted)
      const id = await passkeys.registered(ann.on('laptop'), authenticator())

      expect(await passkeys.remove(bob.on('phone'), id)).toEqual(failed(404))
      expect(await passkeys.remove(ann.on('laptop'), passkeyIdFactory.create())).toEqual(
        failed(404),
      )
      expect((await passkeys.listed(ann.on('laptop'))).map((each) => each.id)).toEqual([id])
    },
    ARGON2_RUNS_MS,
  )

  it(
    'answers 400 bad-request to the removal of an id of another form, before any passkey is looked for',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const id = await passkeys.registered(ann.on('laptop'), authenticator())

      for (const other of ['not-a-passkey', 'x'.repeat(65), `idn_${id.slice(5)}`]) {
        expect(await passkeys.remove(ann.on('laptop'), other)).toEqual({
          status: 400,
          body: { code: 'bad-request' },
        })
      }

      expect(await passkeys.listed(ann.on('laptop'))).toHaveLength(1)
    },
    ARGON2_RUNS_MS,
  )
})

describe('passkeyRoutes, who may ask', () => {
  it(
    'answers 401 without a live session, 400 bad-request without a device, and 405 with the methods a path takes',
    async () => {
      const mounted = await mountedOnRealAuth()
      const ann = await signedInOn(mounted, ANN, ['laptop'])
      const passkeys = passkeysOf(mounted)
      const id = passkeyIdFactory.create()

      for (const [method, path] of [
        ['GET', '/passkeys'],
        ['POST', '/passkeys/options'],
        ['POST', '/passkeys'],
        ['DELETE', `/passkeys/${id}`],
      ] as const) {
        const signedOut = await passkeys.route(
          passkeys.request(
            method,
            path,
            { device: 'laptop', token: 'no-such-token' },
            method === 'POST' ? {} : undefined,
          ),
          '198.18.9.1',
        )
        const noDevice = await passkeys.route(
          new Request(`http://gateway.test${path}`, {
            method,
            headers: { authorization: `Bearer ${ann.tokens.get('laptop') ?? ''}` },
          }),
          '198.18.9.1',
        )

        expect(signedOut?.status).toBe(401)
        expect(signedOut?.headers.get('WWW-Authenticate')).toBe('Bearer')
        expect(noDevice?.status).toBe(400)
      }

      const wrong = async (method: string, path: string) =>
        (
          await passkeys.route(passkeys.request(method, path, ann.on('laptop')), '198.18.9.1')
        )?.headers.get('Allow')

      expect(await wrong('PUT', '/passkeys')).toBe('GET, POST')
      expect(await wrong('GET', '/passkeys/options')).toBe('POST')
      expect(await wrong('GET', `/passkeys/${id}`)).toBe('DELETE')
      expect(
        await passkeys.route(new Request('http://gateway.test/passkeys/'), '198.18.9.1'),
      ).toBeUndefined()
      expect(
        await passkeys.route(new Request('http://gateway.test/devices'), '198.18.9.1'),
      ).toBeUndefined()
    },
    ARGON2_RUNS_MS,
  )
})
