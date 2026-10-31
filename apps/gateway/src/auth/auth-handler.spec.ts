import { afterEach, describe, expect, it, vi } from 'vitest'

import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'
import { z } from '@workspace/zod'

import { RequestLimits } from '../limits/request-limits'
import { SUPERSEDED } from '../sync/sync-connection'

import { deviceHeaders, openAuth } from './__fixtures__/auth-instance'
import { authHandler } from './auth-handler'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** The `n`th address of a client that spreads its sign-ins over many addresses. */
const spread = (n: number): string => `198.51.100.${n}`

const MINUTE_MS = 60_000

/** Better Auth's endpoints the mount does not hand over, each asked by GET and by POST. */
const UNSERVED = [
  '/list-sessions',
  '/revoke-session',
  '/revoke-sessions',
  '/get-session',
  '/sign-out',
  '/update-user',
  '/change-password',
  '/delete-user',
  '/token',
  '/jwks',
  '/ok',
]

const notFound = { status: 404, body: { code: 'not-found' } }

/** What a sign-up or a sign-in answers, as far as these tests read it. */
const signedIn = z.object({ token: z.string().min(1) })

/**
 * A sign-in body that reads two ways: as JSON it names `decoy` with a wrong password; as a form
 * (where the last duplicate key wins) it names Ann and `password`.
 */
function smuggled(decoy: string, password: string): string {
  return JSON.stringify({
    email: decoy,
    password: 'wrong-pass-word',
    p: `&email=ann%40example.test&password=${password}&z=`,
  })
}

/** Closes what a test opened. */
const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) {
    await cleanup()
  }
})

/**
 * A stand-in for Better Auth's handler: it keeps every request it is handed and answers each
 * with what `answer` makes of it.
 */
function fakeAuth(answer: (request: Request) => Response) {
  const received: Request[] = []

  return {
    received,
    auth: {
      handler: async (request: Request) => {
        received.push(request)

        return answer(request)
      },
    },
  }
}

/**
 * A stand-in for the registry of sync connections: it keeps each close it is asked for, by
 * identity, device and code, and resolves each once `closing` does.
 */
function fakeConnections(closing: Promise<void> = Promise.resolve()) {
  const closes: Array<readonly [IdentityId, string | undefined, number]> = []

  return {
    closes,
    connections: {
      close: (identity: IdentityId, device: string | undefined, code: number) => {
        closes.push([identity, device, code])

        return closing
      },
    },
  }
}

/**
 * The mount over a stand-in answering `answer`, with real limits on a manual clock and a stand-in
 * registry whose closes resolve once `closing` does.
 */
function mounted(answer: (request: Request) => Response, closing?: Promise<void>) {
  const clock = manualClock(1_000)
  const fake = fakeAuth(answer)
  const { closes, connections } = fakeConnections(closing)

  return {
    ...fake,
    clock,
    closes,
    route: authHandler(fake.auth, new RequestLimits({ clock }), connections),
  }
}

const status = (code: number) => () => new Response(null, { status: code })

/** `count` times `code`: the statuses of as many sign-ins answered alike. */
const times = (count: number, code: number): number[] => Array.from({ length: count }, () => code)

/** A sign-up of Ann, as Better Auth's client sends it. */
function signUp(): Request {
  return new Request('http://gateway.test/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-perch-device': 'laptop' },
    body: JSON.stringify({ name: 'Ann', email: 'ann@example.test', password: 'pass-word-1' }),
  })
}

/** A sign-in of `email` with a wrong password, as Better Auth's client sends it. */
function signIn(email: string): Request {
  return new Request('http://gateway.test/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-perch-device': 'laptop' },
    body: JSON.stringify({ email, password: 'wrong-pass-word' }),
  })
}

/**
 * The mount over a real Better Auth instance on an embedded directory, and a way to send it a
 * request from a device (none names no device) with a JSON body and a session token, as the
 * gateway receives it: at its own host, not the front's.
 */
async function overBetterAuth() {
  const opened = await openAuth()

  cleanups.push(opened.close)

  const { closes, connections } = fakeConnections()
  const route = authHandler(opened.auth, new RequestLimits({ clock: opened.clock }), connections)
  const send = async (
    method: string,
    path: string,
    device: string | null,
    options: {
      /** The JSON body, or a text sent as it is. */
      readonly body?: object | string
      readonly contentType?: string
      readonly token?: string
      /** The client address, `FROM` unless named. */
      readonly from?: string
    } = {},
  ) => {
    const headers =
      device === null ? new Headers({ origin: 'http://localhost' }) : deviceHeaders(device)

    if (options.body !== undefined) {
      headers.set('content-type', options.contentType ?? 'application/json')
    }

    if (options.token !== undefined) {
      headers.set('authorization', `Bearer ${options.token}`)
    }

    const response = await route(
      new Request(`http://127.0.0.1:4000${path}`, {
        method,
        headers,
        ...(options.body === undefined
          ? {}
          : {
              body: typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
            }),
      }),
      options.from ?? FROM,
    )

    return {
      status: response?.status ?? 0,
      text: (await response?.text()) ?? '',
      cookies: response?.headers.getSetCookie() ?? [],
    }
  }
  /** Signs Ann up on her laptop and in on her phone through the mount: each device's token. */
  const annOnTwoDevices = async () => {
    const credentials = { email: 'ann@example.test', password: 'pass-word-1' }
    const up = await send('POST', '/auth/sign-up/email', 'laptop', {
      body: { name: 'Ann', ...credentials },
    })
    const phone = await send('POST', '/auth/sign-in/email', 'phone', { body: credentials })

    return {
      laptop: signedIn.parse(JSON.parse(up.text)).token,
      phone: signedIn.parse(JSON.parse(phone.text)).token,
      answers: [up.text, phone.text],
    }
  }

  return { ...opened, closes, route, send, annOnTwoDevices }
}

/**
 * The statuses `count` sign-ins of `email` are answered with, one after the other, each from an
 * address of its own: only the email's limit counts them.
 */
async function signIns(
  route: ReturnType<typeof mounted>['route'],
  email: string,
  count: number,
): Promise<number[]> {
  const statuses: number[] = []

  for (let n = 0; n < count; n += 1) {
    statuses.push((await route(signIn(email), spread(n)))?.status ?? 0)
  }

  return statuses
}

describe('authHandler', () => {
  it("hands a request to Better Auth at the auth routes' public path, its method, headers and body kept", async () => {
    const { route, received } = mounted(() => Response.json({ token: 'raw-token' }))
    const body = JSON.stringify({ name: 'Ann', email: 'ann@example.test', password: 'pass-word-1' })
    const sent = new Request('http://gateway.test/auth/sign-up/email?callbackURL=%2F', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost',
        'x-perch-device': 'laptop',
        'x-perch-device-label': 'Firefox on Linux',
      },
      body,
    })
    const headers = [...sent.headers]
    const response = await route(sent, FROM)

    expect(response?.status).toBe(200)
    expect(received).toHaveLength(1)

    const [handed] = received
    const url = new URL(handed?.url ?? expect.unreachable('a request handed over'))

    expect(url.pathname).toBe('/backend/auth/sign-up/email')
    expect(url.search).toBe('?callbackURL=%2F')
    expect(handed?.method).toBe('POST')
    expect([...(handed?.headers ?? [])]).toEqual(headers)
    expect(await handed?.text()).toBe(body)
  })

  it('hands the sign-up and the sign-in to Better Auth at their public paths, and nothing else', async () => {
    const { route, received } = mounted(status(200))

    expect(
      (await route(new Request('http://gateway.test/auth/sign-up/email', { method: 'POST' }), FROM))
        ?.status,
    ).toBe(200)
    expect((await route(signIn('ann@example.test'), FROM))?.status).toBe(200)
    expect(received.map((request) => [request.method, new URL(request.url).pathname])).toEqual([
      ['POST', '/backend/auth/sign-up/email'],
      ['POST', '/backend/auth/sign-in/email'],
    ])
  })

  it('answers 404 to every other endpoint of Better Auth, without reaching it', async () => {
    const { route, received } = mounted(status(200))

    for (const path of UNSERVED) {
      for (const method of ['GET', 'POST']) {
        const response = await route(
          new Request(`http://gateway.test/auth${path}`, { method }),
          FROM,
        )

        expect({ path, method, status: response?.status, body: await response?.json() }).toEqual({
          path,
          method,
          ...notFound,
        })
      }
    }

    expect(received).toHaveLength(0)
  })

  it('answers 405 with Allow to another method on the sign-up and the sign-in', async () => {
    const { route, received } = mounted(status(200))

    for (const [method, path] of [
      ['GET', '/auth/sign-up/email'],
      ['GET', '/auth/sign-in/email'],
      ['PUT', '/auth/sign-in/email'],
    ] as const) {
      const response = await route(new Request(`http://gateway.test${path}`, { method }), FROM)

      expect(response?.status).toBe(405)
      expect(await response?.json()).toEqual({ code: 'method-not-allowed' })
      expect(response?.headers.get('Allow')).toBe('POST')
    }

    expect(received).toHaveLength(0)
  })

  it('answers the 21st sign-up from one address within 10 s 429 with Retry-After, without asking Better Auth', async () => {
    const { route, received, clock } = mounted(status(200))
    const signUps = async (from: string, count: number) => {
      const statuses: number[] = []

      for (let n = 0; n < count; n += 1) {
        statuses.push((await route(signUp(), from))?.status ?? 0)
      }

      return statuses
    }

    expect(await signUps(FROM, 20)).toEqual(times(20, 200))
    await clock.advance(4_000)

    const refused = await route(signUp(), FROM)

    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toEqual({ code: 'rate-limited' })
    expect(refused?.headers.get('Retry-After')).toBe('6')
    expect(received).toHaveLength(20)
    // Another address keeps its own limit.
    expect(await signUps(ELSEWHERE, 1)).toEqual([200])
    // Once the window has passed, the address signs up again.
    await clock.advance(6_000)
    expect(await signUps(FROM, 1)).toEqual([200])
    expect(received).toHaveLength(22)
  })

  it("counts an address's sign-ups and sign-ins against one limit; a sign-in it refuses takes no place of its email", async () => {
    const { route, received } = mounted((request) =>
      new URL(request.url).pathname.endsWith('/sign-up/email')
        ? new Response(null, { status: 200 })
        : new Response(null, { status: 401 }),
    )

    for (let n = 0; n < 10; n += 1) {
      expect((await route(signUp(), FROM))?.status).toBe(200)
      expect((await route(signIn('ann@example.test'), FROM))?.status).toBe(401)
    }

    const refused = await route(signIn('bob@example.test'), FROM)

    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toEqual({ code: 'rate-limited' })
    expect(refused?.headers.get('Retry-After')).toBe('10')
    expect(received).toHaveLength(20)
    // Bob's refused sign-in took none of his email's ten places.
    expect(await signIns(route, 'bob@example.test', 11)).toEqual([...times(10, 401), 429])
  })

  it("answers an email's eleventh sign-in after ten failed ones 429 with Retry-After, without asking Better Auth", async () => {
    const { route, received } = mounted(status(401))

    expect(await signIns(route, 'ann@example.test', 10)).toEqual(times(10, 401))

    const refused = await route(signIn('ann@example.test'), FROM)

    expect(refused?.status).toBe(429)
    expect(await refused?.json()).toEqual({ code: 'rate-limited' })
    expect(refused?.headers.get('Retry-After')).toBe(String((15 * MINUTE_MS) / 1000))
    expect(received).toHaveLength(10)
    // Another email keeps its own limit.
    expect(await signIns(route, 'bob@example.test', 1)).toEqual([401])
  })

  it('counts an email in any case against one limit', async () => {
    const { route, received } = mounted(status(401))

    await signIns(route, 'ann@example.test', 5)
    await signIns(route, 'Ann@Example.TEST', 5)

    expect(await signIns(route, 'ANN@example.test', 1)).toEqual([429])
    expect(received).toHaveLength(10)
  })

  it("clears an email's failed sign-ins once one succeeds", async () => {
    let answer = 401
    const { route, received } = mounted(() => new Response(null, { status: answer }))

    await signIns(route, 'ann@example.test', 9)
    answer = 200
    expect(await signIns(route, 'ann@example.test', 1)).toEqual([200])
    answer = 401

    // The success forgot the nine failures: ten more reach Better Auth before the limit.
    expect(await signIns(route, 'ann@example.test', 11)).toEqual([...times(10, 401), 429])
    expect(received).toHaveLength(20)
  })

  it('gives the place of a sign-in Better Auth did not judge back', async () => {
    let answer = 500
    const { route, received } = mounted(() => new Response(null, { status: answer }))

    // Answers that are neither a success nor wrong credentials count nothing.
    expect(await signIns(route, 'ann@example.test', 12)).toEqual(times(12, 500))
    answer = 429
    expect(await signIns(route, 'ann@example.test', 12)).toEqual(times(12, 429))
    answer = 401
    expect(await signIns(route, 'ann@example.test', 11)).toEqual([...times(10, 401), 429])
    expect(received).toHaveLength(34)
  })

  it('gives the place of a sign-in whose handler threw back, and lets the throw through', async () => {
    let fail = true
    const { route } = mounted(() => {
      if (fail) {
        throw new Error('the handler failed')
      }

      return new Response(null, { status: 401 })
    })

    for (let n = 0; n < 12; n += 1) {
      await expect(route(signIn('ann@example.test'), FROM)).rejects.toThrow('the handler failed')
    }

    fail = false
    expect(await signIns(route, 'ann@example.test', 11)).toEqual([...times(10, 401), 429])
  })

  it('lets the email sign in again once its window has passed', async () => {
    const { route, clock } = mounted(status(401))

    await signIns(route, 'ann@example.test', 10)
    expect(await signIns(route, 'ann@example.test', 1)).toEqual([429])
    await clock.advance(15 * MINUTE_MS)
    expect(await signIns(route, 'ann@example.test', 1)).toEqual([401])
  })

  it('answers 400 to a sign-in whose body is not JSON naming an email, without asking Better Auth', async () => {
    const { route, received } = mounted(status(401))
    const sent = (contentType: string, body: string) =>
      new Request('http://gateway.test/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': contentType },
        body,
      })

    for (const request of [
      // Better Auth takes a form too; the limit could not tell its email, so it is refused.
      sent('application/x-www-form-urlencoded', 'email=ann%40example.test&password=wrong-pass'),
      sent('application/json', '{"email":'),
      sent('application/json', '{"password":"wrong-pass-word"}'),
      sent('application/json', '{"email":["ann@example.test"]}'),
      new Request('http://gateway.test/auth/sign-in/email', { method: 'POST' }),
    ]) {
      const response = await route(request, FROM)

      expect(response?.status).toBe(400)
      expect(await response?.json()).toEqual({ code: 'bad-request' })
    }

    expect(received).toHaveLength(0)
    // None of them took a place.
    expect(await signIns(route, 'ann@example.test', 11)).toEqual([...times(10, 401), 429])
  })

  it('hands Better Auth the sign-in body the limit counted, as JSON, whatever its content type', async () => {
    const { route, received } = mounted(status(401))
    const body = smuggled('decoy@example.test', 'guess-pass-word')
    const sent = new Request('http://gateway.test/auth/sign-in/email', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
        'x-perch-device': 'laptop',
      },
      body,
    })

    expect((await route(sent, FROM))?.status).toBe(401)

    const [handed] = received

    expect(handed?.headers.get('content-type')).toBe('application/json')
    expect(handed?.headers.get('x-perch-device')).toBe('laptop')
    // Better Auth reads the email the limit counted, not the one a form reading would find.
    expect(JSON.parse((await handed?.text()) ?? '')).toEqual(JSON.parse(body))
    // The decoy was counted: nine more failures and its eleventh sign-in is refused.
    expect(await signIns(route, 'decoy@example.test', 10)).toEqual([...times(9, 401), 429])
  })

  it("strips every Set-Cookie from Better Auth's answers, the rest of the answer kept", async () => {
    const body = JSON.stringify({ token: 'raw-token' })
    const { route } = mounted(() => {
      const headers = new Headers({ 'content-type': 'application/json' })

      headers.append('Set-Cookie', 'better-auth.session_token=signed; Path=/; HttpOnly')
      headers.append('Set-Cookie', 'better-auth.session_data=cached; Path=/; HttpOnly')

      return new Response(body, { status: 200, headers })
    })

    for (const request of [signUp(), signIn('ann@example.test')]) {
      const response = await route(request, FROM)

      expect(response?.status).toBe(200)
      expect(response?.headers.getSetCookie()).toEqual([])
      expect(response?.headers.has('set-cookie')).toBe(false)
      expect(response?.headers.get('content-type')).toBe('application/json')
      expect(await response?.text()).toBe(body)
    }
  })

  it("reaches Better Auth's sign-up and sign-in from the path the gateway receives", async () => {
    const { send } = await overBetterAuth()
    const credentials = { email: 'ann@example.test', password: 'pass-word-1' }
    const up = await send('POST', '/auth/sign-up/email', 'laptop', {
      body: { name: 'Ann', ...credentials },
    })

    expect(up.status).toBe(200)
    expect(
      (
        await send('POST', '/auth/sign-in/email', 'laptop', {
          body: { ...credentials, password: 'wrong-pass-word' },
        })
      ).status,
    ).toBe(401)

    const again = await send('POST', '/auth/sign-in/email', 'laptop', { body: credentials })

    expect(again.status).toBe(200)
    // Better Auth answers the raw session token in the body, and no cookie reaches the client.
    expect(signedIn.safeParse(JSON.parse(again.text)).success).toBe(true)
    expect([up.cookies, again.cookies]).toEqual([[], []])
  })

  it('keeps a locked email locked when a sign-in body names it only when read as a form', async () => {
    const { send } = await overBetterAuth()
    const credentials = { email: 'ann@example.test', password: 'pass-word-1' }
    const signIn = (body: object | string, contentType?: string, from = FROM) =>
      send('POST', '/auth/sign-in/email', 'laptop', {
        body,
        from,
        ...(contentType === undefined ? {} : { contentType }),
      })

    await send('POST', '/auth/sign-up/email', 'laptop', { body: { name: 'Ann', ...credentials } })

    for (let n = 0; n < 10; n += 1) {
      expect((await signIn({ ...credentials, password: 'wrong-pass-word' })).status).toBe(401)
    }

    expect((await signIn(credentials)).status).toBe(429)

    // Read as a form, each body names Ann with her right password; Better Auth is handed the JSON
    // the limit counted, which names the decoy, so Ann is never signed in and the decoy is limited.
    const statuses: number[] = []

    for (let n = 0; n < 11; n += 1) {
      statuses.push(
        (
          await signIn(
            smuggled('decoy@example.test', credentials.password),
            'application/x-www-form-urlencoded',
            spread(n),
          )
        ).status,
      )
    }

    expect(statuses).toEqual([...times(10, 401), 429])
    expect((await signIn(credentials)).status).toBe(429)
  })

  it("answers 404 to a device listing the account's sessions: no device learns another one's token", async () => {
    const { send, annOnTwoDevices } = await overBetterAuth()
    const { laptop, phone, answers } = await annOnTwoDevices()

    // With the phone's own token, whether it names its device or not.
    for (const device of ['phone', null]) {
      for (const method of ['GET', 'POST']) {
        const listed = await send(method, '/auth/list-sessions', device, { token: phone })

        expect(listed.status).toBe(404)
        answers.push(listed.text)
      }
    }

    // The laptop's token went to the laptop's own sign-up answer only.
    expect(answers.filter((answer) => answer.includes(laptop))).toEqual([answers[0]])
  })

  it("answers 404 to Better Auth's own ending of a session, which would leave its sockets open", async () => {
    const { auth, send, annOnTwoDevices } = await overBetterAuth()
    const { laptop, phone } = await annOnTwoDevices()

    for (const path of ['/auth/revoke-session', '/auth/sign-out']) {
      expect(
        (await send('POST', path, 'phone', { token: phone, body: { token: laptop } })).status,
      ).toBe(404)
    }

    // Both sessions are still live: only the gateway's device routes end one.
    for (const token of [laptop, phone]) {
      expect(
        await auth.api.getSession({ headers: new Headers({ authorization: `Bearer ${token}` }) }),
      ).not.toBeNull()
    }
  })

  it("closes the device's sockets of the identity signed in with 1000 before it answers the sign-in", async () => {
    const ann = identityIdFactory.create()
    let release = () => {}
    const closing = new Promise<void>((resolve) => {
      release = resolve
    })
    const { route, closes } = mounted(
      () => Response.json({ token: 'raw-token', user: { id: ann } }),
      closing,
    )
    let answered = false
    const answer = route(signIn('ann@example.test'), FROM).then((response) => {
      answered = true

      return response
    })

    await vi.waitFor(() => expect(closes).toEqual([[ann, 'laptop', SUPERSEDED]]))
    expect(answered).toBe(false)

    release()

    expect((await answer)?.status).toBe(200)
    expect(await (await answer)?.json()).toEqual({ token: 'raw-token', user: { id: ann } })
  })

  it("closes the device's sockets once a sign-up is answered too", async () => {
    const ann = identityIdFactory.create()
    const { route, closes } = mounted(() =>
      Response.json({ token: 'raw-token', user: { id: ann } }),
    )

    expect((await route(signUp(), FROM))?.status).toBe(200)
    expect(closes).toEqual([[ann, 'laptop', SUPERSEDED]])
  })

  it('closes nothing for a sign-in Better Auth refused, or an answer that names no identity or no device', async () => {
    const ann = identityIdFactory.create()
    const answers: Array<() => Response> = [
      () => Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }),
      () => new Response('not json', { status: 200 }),
      () => Response.json({ token: 'raw-token' }),
      () => Response.json({ token: 'raw-token', user: { id: 'not-an-identity' } }),
    ]

    for (const answer of answers) {
      const { route, closes } = mounted(answer)
      const response = await route(signIn('ann@example.test'), FROM)

      expect(response?.status).toBe(answer().status)
      expect(await response?.text()).toBe(await answer().text())
      expect(closes).toEqual([])
    }

    // A sign-up that names no device: Better Auth refuses it, and a stand-in that does not closes
    // nothing all the same.
    const { route, closes } = mounted(() =>
      Response.json({ token: 'raw-token', user: { id: ann } }),
    )
    const unnamed = new Request('http://gateway.test/auth/sign-up/email', { method: 'POST' })

    expect((await route(unnamed, FROM))?.status).toBe(200)
    expect(closes).toEqual([])
  })

  it('closes the sockets of the device each sign-up and sign-in Better Auth accepts, and none for wrong credentials', async () => {
    const { send, closes } = await overBetterAuth()
    const credentials = { email: 'ann@example.test', password: 'pass-word-1' }
    const up = await send('POST', '/auth/sign-up/email', 'laptop', {
      body: { name: 'Ann', ...credentials },
    })
    const ann = z.object({ user: z.object({ id: z.string() }) }).parse(JSON.parse(up.text)).user.id

    expect(closes).toEqual([[ann, 'laptop', SUPERSEDED]])

    const wrong = await send('POST', '/auth/sign-in/email', 'phone', {
      body: { ...credentials, password: 'wrong-pass-word' },
    })

    expect(wrong.status).toBe(401)
    expect(closes).toHaveLength(1)
    expect((await send('POST', '/auth/sign-in/email', 'phone', { body: credentials })).status).toBe(
      200,
    )
    expect(closes).toEqual([
      [ann, 'laptop', SUPERSEDED],
      [ann, 'phone', SUPERSEDED],
    ])
  })

  it('leaves a path outside /auth/ to the other routes', async () => {
    const { route, received } = mounted(status(200))

    for (const path of ['/devices', '/organisations', '/auth', '/authority/sign-in', '/health']) {
      expect(await route(new Request(`http://gateway.test${path}`), FROM)).toBeUndefined()
    }

    expect(received).toHaveLength(0)
  })
})
