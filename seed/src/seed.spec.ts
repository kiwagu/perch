import { describe, expect, it } from 'vitest'

import { TEST_SIGNING_KEY } from '@workspace/data/testing'

import { runSeed } from './seed'

describe('runSeed', () => {
  it("calls the gateway's routes through the fetcher it is given", async () => {
    const called: string[] = []
    const seeded = await runSeed({
      gatewayUrl: 'http://127.0.0.1:9',
      url: 'http://127.0.0.1:9',
      namespace: 'app',
      database: 'directory',
      credentials: { username: 'root', password: 'root' },
      signingKey: TEST_SIGNING_KEY,
      mode: { kind: 'demo' },
      fetcher: (url) => {
        called.push(url)

        return Promise.resolve(Response.json({ code: 'internal' }, { status: 503 }))
      },
    })

    expect(called).toEqual(['http://127.0.0.1:9/auth/sign-up'])
    expect(seeded._unsafeUnwrapErr().message).toBe('the gateway refused the request with 503')
  })
})
