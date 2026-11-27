import { describe, expect, it } from 'vitest'

import { two_factorIdFactory } from '@workspace/ids'

import { fakeFetch, noContent, respond } from './__fixtures__/gateway-fetch'
import { twoFactorApi } from './two-factor-api'

const enrolment = two_factorIdFactory.create()

const backupCodes = Array.from({ length: 10 }, (_, at) => `code-${at}-abcde`)

/** What the gateway answers a turning on with. */
const enabled = {
  key: 'JBSWY3DPEHPK3PXP',
  uri: 'otpauth://totp/Perch:ann%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Perch',
  backupCodes,
  enrolment,
}

/** The client over `fetcher`, with the session token `token()` and the device `device-1`. */
function api(
  fetcher: ReturnType<typeof fakeFetch>['fetcher'],
  token: () => string | undefined = () => 'token-1',
) {
  return twoFactorApi('/backend', { token, device: () => 'device-1', fetcher })
}

const bearer = (method: string, url: string, body?: unknown) => ({
  url: `/backend${url}`,
  method,
  authorization: 'Bearer token-1',
  device: 'device-1',
  body,
})

describe('twoFactorApi', () => {
  it('reads whether the second factor is on', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { enabled: true }))

    expect((await api(fetcher).read())._unsafeUnwrap()).toEqual({ enabled: true })
    expect(sent).toEqual([bearer('GET', '/two-factor')])
  })

  it('starts turning it on with the password, and answers the key, the URI, the ten codes and the enrolment', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, enabled))

    expect((await api(fetcher).enable('Pass-word-1'))._unsafeUnwrap()).toEqual(enabled)
    expect(sent).toEqual([bearer('POST', '/two-factor/enable', { password: 'Pass-word-1' })])
  })

  it.each([
    ['fewer than ten codes', { ...enabled, backupCodes: backupCodes.slice(1) }],
    ['no enrolment', { ...enabled, enrolment: undefined }],
    ['an enrolment that is no id of a key', { ...enabled, enrolment: 'abc' }],
    ['no key', { ...enabled, key: '' }],
  ])('refuses an answer with %s, quoting none of it', async (_, body) => {
    const { fetcher } = fakeFetch(respond(200, body))
    const failed = (await api(fetcher).enable('Pass-word-1'))._unsafeUnwrapErr()

    expect(failed.code).toBe('data:AUTH_FAILED')
    expect(JSON.stringify(failed)).not.toContain('code-0-abcde')
  })

  it('confirms the key with a code and the enrolment it answered', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await api(fetcher).confirm('123456', enrolment))._unsafeUnwrap()).toBeUndefined()
    expect(sent).toEqual([bearer('POST', '/two-factor/confirm', { code: '123456', enrolment })])
  })

  it('turns it off with the password', async () => {
    const { fetcher, sent } = fakeFetch(noContent())

    expect((await api(fetcher).disable('Pass-word-1'))._unsafeUnwrap()).toBeUndefined()
    expect(sent).toEqual([bearer('POST', '/two-factor/disable', { password: 'Pass-word-1' })])
  })

  it('renews the backup codes with the password, answering ten new ones', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { backupCodes }))

    expect((await api(fetcher).renewCodes('Pass-word-1'))._unsafeUnwrap()).toEqual({ backupCodes })
    expect(sent).toEqual([bearer('POST', '/two-factor/renew-codes', { password: 'Pass-word-1' })])
  })

  it.each([
    ['a wrong password', 400, 'invalid-credentials', 'data:INVALID_CREDENTIALS'],
    ['a wrong code', 400, 'invalid-code', 'data:INVALID_CODE'],
    [
      'a key or a factor that changed meanwhile',
      409,
      'two-factor-changed',
      'data:TWO_FACTOR_CHANGED',
    ],
    ['a request to wait', 429, 'rate-limited', 'data:RATE_LIMITED'],
    ['a request the gateway cannot read', 400, 'bad-request', 'data:WRITE_REJECTED'],
    ['a refusal by the policy', 403, 'failed', 'data:WRITE_REJECTED'],
  ] as const)('keeps the meaning of %s on each change', async (_, status, code, expected) => {
    const api1 = api(fakeFetch(respond(status, { code })).fetcher)
    const asked = [
      api1.enable('Pass-word-1'),
      api1.confirm('123456', enrolment),
      api1.disable('Pass-word-1'),
      api1.renewCodes('Pass-word-1'),
    ]

    for (const result of await Promise.all(asked)) {
      expect(result._unsafeUnwrapErr().code).toBe(expected)
    }
  })

  it('on 401 gives up with data:AUTH_FAILED without a second request: the token is dead', async () => {
    const { fetcher, sent } = fakeFetch(
      respond(401, { code: 'unauthorized' }),
      respond(200, enabled),
    )

    expect((await api(fetcher).read())._unsafeUnwrapErr().code).toBe('data:AUTH_FAILED')
    expect(sent).toHaveLength(1)
  })

  it('asks nothing of the gateway while the device holds no session', async () => {
    const { fetcher, sent } = fakeFetch(respond(200, { enabled: true }))

    expect((await api(fetcher, () => undefined).read())._unsafeUnwrapErr().code).toBe(
      'data:AUTH_FAILED',
    )
    expect(sent).toEqual([])
  })

  it('fails as data:OFFLINE when the gateway cannot be reached', async () => {
    const down = api(() => Promise.reject(new Error('down')))

    expect((await down.read())._unsafeUnwrapErr().code).toBe('data:OFFLINE')
  })
})
