import { describe, expect, it } from 'vitest'

import { runSeed } from './run'

describe('runSeed', () => {
  it("calls the gateway's routes through the fetcher it is given", async () => {
    const called: string[] = []
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'demo' },
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual(['http://127.0.0.1:9/auth/sign-up/email'])
    expect(seeded._unsafeUnwrapErr().message).toBe('the gateway refused the request with 503')
  })

  it('refuses a catalog the run would not hold before it sweeps or calls the gateway', async () => {
    const called: string[] = []
    const run = 'r'.repeat(40)
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      mode: { kind: 'fresh', run },
      reset: true,
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual([])
    expect(seeded._unsafeUnwrapErr()).toMatchObject({
      code: 'data:QUERY_FAILED',
      message: `the seed catalog is refused: organisation acme: key acme_${run} is not a tenant key`,
    })
  })
})
