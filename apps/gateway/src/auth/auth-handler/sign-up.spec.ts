import { describe, expect, it, vi } from 'vitest'

import {
  mountedOnFakeAuth,
  mountedOnRealAuth,
  resendRequest,
  signUpRequest,
} from './__fixtures__/mount'
import { SIGN_UP_FLOOR_MS } from './sign-up'

/** The client address a request comes from, unless a test names another. */
const FROM = '203.0.113.7'

/** Another client address, which nothing from `FROM` charges. */
const ELSEWHERE = '203.0.113.8'

/** What Better Auth answers a sign-up it accepted, new email or taken. */
const accepted = () => Response.json({ token: null, user: {} })

describe('authHandler, the sign-up', () => {
  it('answers a new, a taken and a concurrently taken email alike, at the floor', async () => {
    const { route, clock, outbox } = await mountedOnRealAuth()
    let settled = 0
    const up = (email: string) =>
      route(signUpRequest(email), FROM).finally(() => {
        settled += 1
      })
    const pending = [
      up('ann@example.test'),
      up('ann@example.test'),
      up('bob@example.test'),
      up('bob@example.test'),
    ]

    // Better Auth has answered all four: only the floor holds their answers back.
    await vi.waitFor(() => expect(clock.pending()).toBe(4))
    expect(settled).toBe(0)
    await clock.advance(SIGN_UP_FLOOR_MS)

    const answers = await Promise.all(pending)

    for (const answer of answers) {
      expect(answer?.status).toBe(202)
      expect(await answer?.text()).toBe('')
      expect(answer?.headers.get('set-cookie')).toBeNull()
      expect([...(answer?.headers.keys() ?? [])].sort()).toEqual(
        [...(answers[0]?.headers.keys() ?? [])].sort(),
      )
    }

    const later = up('ann@example.test')

    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await later)?.status).toBe(202)
    await outbox.next('ann@example.test')
    await outbox.next('bob@example.test')
    expect(outbox.to('ann@example.test')).toHaveLength(1)
    expect(outbox.to('bob@example.test')).toHaveLength(1)
  })

  it('answers no sooner than the floor after the request began', async () => {
    const { route, clock } = mountedOnFakeAuth(accepted)
    let settled = false
    const pending = route(signUpRequest('ann@example.test'), FROM).then((answer) => {
      settled = true

      return answer
    })

    // Better Auth has answered: only the floor holds the answer back.
    await vi.waitFor(() => expect(clock.pending()).toBe(1))
    await clock.advance(SIGN_UP_FLOOR_MS - 1)
    expect(settled).toBe(false)
    await clock.advance(1)
    expect((await pending)?.status).toBe(202)
  })

  it("takes the address's verification mails for every sign-up, whatever the email", async () => {
    const { route, clock } = mountedOnFakeAuth(accepted)

    for (let n = 0; n < 180; n += 1) {
      expect((await route(resendRequest(`r${n}@example.test`), FROM))?.status).toBe(202)
    }

    for (let n = 0; n < 20; n += 1) {
      const pending = route(signUpRequest(`s${n}@example.test`), FROM)

      await clock.advance(SIGN_UP_FLOOR_MS)
      expect((await pending)?.status).toBe(202)
    }

    await clock.advance(10_000)
    expect((await route(signUpRequest('one-more@example.test'), FROM))?.status).toBe(429)

    const elsewhere = route(signUpRequest('one-more@example.test'), ELSEWHERE)

    await clock.advance(SIGN_UP_FLOOR_MS)
    expect((await elsewhere)?.status).toBe(202)
  })

  it('refuses a body without an email, and closes no socket for any sign-up', async () => {
    const { route, closes } = mountedOnFakeAuth(accepted)

    expect(
      (
        await route(
          new Request('http://gateway.test/auth/sign-up/email', { method: 'POST', body: '{}' }),
          FROM,
        )
      )?.status,
    ).toBe(400)
    expect(closes).toEqual([])
  })
})
