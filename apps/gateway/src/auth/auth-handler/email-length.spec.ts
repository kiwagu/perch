import { describe, expect, it } from 'vitest'

import {
  mountedOnFakeAuth,
  mountedOnRealAuth,
  PASSWORD,
  pastFloor,
  postTo,
  resendRequest,
  signInRequest,
  signUpRequest,
} from './__fixtures__/mount'
import { RESET_REQUEST_FLOOR_MS } from './password-reset'
import { SIGN_UP_FLOOR_MS } from './sign-up'

/** The client address a request comes from. */
const FROM = '203.0.113.7'

/** The longest email an address can be. */
const LONGEST = 254

/** An email of exactly `length` characters. */
const emailOf = (length: number): string =>
  `${'e'.repeat(length - '@example.test'.length)}@example.test`

/** What Better Auth answers a request it accepted. */
const accepted = () => Response.json({ token: null, user: {}, status: true })

describe('authHandler, the longest email a body names', () => {
  it('takes the sign-up of an email of 254 characters and refuses one of 255, Better Auth not asked', async () => {
    const { route, clock, received } = mountedOnFakeAuth(accepted)
    const taken = route(signUpRequest(emailOf(LONGEST)), FROM)

    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await taken)?.status).toBe(202)
    expect(received).toHaveLength(1)

    const refused = await route(signUpRequest(emailOf(LONGEST + 1)), FROM)

    expect(refused?.status).toBe(400)
    expect(await refused?.json()).toEqual({ code: 'bad-request' })
    expect(received).toHaveLength(1)
  })

  it('asks Better Auth to sign in an email of 254 characters and refuses one of 255 at once', async () => {
    const { route, received } = mountedOnFakeAuth(() =>
      Response.json({ code: 'INVALID_EMAIL_OR_PASSWORD' }, { status: 401 }),
    )
    const signIn = (email: string) => route(signInRequest(email, PASSWORD, 'laptop'), FROM)

    expect((await signIn(emailOf(LONGEST)))?.status).toBe(401)
    expect(received).toHaveLength(1)

    const refused = await signIn(emailOf(LONGEST + 1))

    expect(refused?.status).toBe(400)
    expect(await refused?.json()).toEqual({ code: 'bad-request' })
    expect(received).toHaveLength(1)
  })

  it('takes the resend to an email of 254 characters and refuses one of 255, Better Auth not asked', async () => {
    const { route, received } = mountedOnFakeAuth(accepted)

    expect((await route(resendRequest(emailOf(LONGEST)), FROM))?.status).toBe(202)
    expect(received).toHaveLength(1)

    const refused = await route(resendRequest(emailOf(LONGEST + 1)), FROM)

    expect(refused?.status).toBe(400)
    expect(await refused?.json()).toEqual({ code: 'bad-request' })
    expect(received).toHaveLength(1)
  })

  it('takes the request for a reset mail of an email of 254 characters and refuses one of 255', async () => {
    const mounted = await mountedOnRealAuth()
    const ask = (email: string) =>
      mounted.route(postTo('/auth/request-password-reset', { email }), FROM)
    const taken = await pastFloor(mounted.clock, ask(emailOf(LONGEST)), RESET_REQUEST_FLOOR_MS)

    expect(taken?.status).toBe(202)

    const refused = await ask(emailOf(LONGEST + 1))

    expect(refused?.status).toBe(400)
    expect(await refused?.json()).toEqual({ code: 'bad-request' })
  })
})
