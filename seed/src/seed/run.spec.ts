import { describe, expect, it } from 'vitest'

import type { Inbox } from '@workspace/web/seeding'

import { runSeed } from './run'

/** A mailbox that records each look: a run the gateway refuses at once never looks. */
function untouchedInbox() {
  const asked: string[] = []
  const inbox: Inbox = {
    count: (email) => {
      asked.push(`count ${email}`)

      return Promise.resolve(0)
    },
    verificationToken: (email) => {
      asked.push(`token ${email}`)

      return Promise.reject(new Error('no mail in this test'))
    },
  }

  return { asked, inbox }
}

describe('runSeed', () => {
  it("calls the gateway's routes through the fetcher it is given, signing in first", async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'demo' },
      inbox,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual(['http://127.0.0.1:9/auth/sign-in/email'])
    expect(seeded._unsafeUnwrapErr().message).toBe('the gateway refused the request with 503')
    expect(asked).toEqual([])
  })

  it('refuses a catalog the run would not hold before it sweeps or calls the gateway', async () => {
    const called: string[] = []
    const { asked, inbox } = untouchedInbox()
    const run = 'r'.repeat(40)
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'fresh', run },
      reset: true,
      inbox,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual([])
    expect(asked).toEqual([])
    expect(seeded._unsafeUnwrapErr()).toMatchObject({
      code: 'data:QUERY_FAILED',
      message: `the seed catalog is refused: organisation acme: key acme_${run} is not a tenant key`,
    })
  })
})
