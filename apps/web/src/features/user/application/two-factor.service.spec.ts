import { describe, expect, it, vi } from 'vitest'

import {
  FACTOR_PASSWORD,
  FakeTwoFactor,
  KEY,
  RENEWED_CODES,
  RIGHT_CODE,
  START_CODES,
} from '../../../platform/__fixtures__/two-factor'

import { TwoFactorService } from './two-factor.service'

const DRAWN = '<svg xmlns="http://www.w3.org/2000/svg"></svg>'

function service(draw: (uri: string) => Promise<string> = () => Promise.resolve(DRAWN)) {
  const factor = new FakeTwoFactor()

  return { factor, service: new TwoFactorService(factor, draw) }
}

describe('TwoFactorService', () => {
  it('reads whether the second factor is on', async () => {
    const { factor, service: twoFactor } = service()

    expect((await twoFactor.read())._unsafeUnwrap()).toBe(false)

    factor.enabled = true

    expect((await twoFactor.read())._unsafeUnwrap()).toBe(true)
  })

  it("starts turning it on with the key, its codes, its enrolment and the key's QR", async () => {
    const draw = vi.fn((_uri: string) => Promise.resolve(DRAWN))
    const { service: twoFactor } = service(draw)

    const start = (await twoFactor.enable(FACTOR_PASSWORD))._unsafeUnwrap()

    expect(start).toMatchObject({ key: KEY, backupCodes: START_CODES, qr: DRAWN })
    expect(start.enrolment).toMatch(/^tfa_/)
    // What the QR carries is the address the gateway answered, which holds the key.
    expect(draw).toHaveBeenCalledWith(start.uri)
    expect(start.uri).toContain(`secret=${KEY}`)
  })

  it('draws nothing for a password that is refused', async () => {
    const draw = vi.fn((_uri: string) => Promise.resolve(DRAWN))
    const { service: twoFactor } = service(draw)

    const refused = await twoFactor.enable('Wrong-pass1')

    expect(refused._unsafeUnwrapErr().code).toBe('data:INVALID_CREDENTIALS')
    expect(draw).not.toHaveBeenCalled()
  })

  it('fails the start, the factor staying off and nothing of the key in the failure, when the QR cannot be drawn', async () => {
    const { factor, service: twoFactor } = service(() =>
      Promise.reject(new Error('the chunk did not load')),
    )

    const refused = (await twoFactor.enable(FACTOR_PASSWORD))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(JSON.stringify(refused.message)).not.toContain(KEY)
    expect(factor.enabled).toBe(false)
  })

  it('confirms a start with a code of its key, which turns the factor on', async () => {
    const { factor, service: twoFactor } = service()
    const start = (await twoFactor.enable(FACTOR_PASSWORD))._unsafeUnwrap()

    expect((await twoFactor.confirm(RIGHT_CODE, start.enrolment)).isOk()).toBe(true)
    expect(factor.enabled).toBe(true)
  })

  it('refuses a code of no length the contract allows before asking the gateway', async () => {
    const { factor, service: twoFactor } = service()
    const start = (await twoFactor.enable(FACTOR_PASSWORD))._unsafeUnwrap()

    for (const code of ['', '12345', '123456789012']) {
      expect((await twoFactor.confirm(code, start.enrolment))._unsafeUnwrapErr().code).toBe(
        'sign-in:CODE_INVALID',
      )
    }

    expect(factor.calls.filter(([call]) => call === 'confirm')).toEqual([])
  })

  it("passes the gateway's refusal of a wrong code on", async () => {
    const { service: twoFactor } = service()
    const start = (await twoFactor.enable(FACTOR_PASSWORD))._unsafeUnwrap()

    expect((await twoFactor.confirm('654321', start.enrolment))._unsafeUnwrapErr().code).toBe(
      'data:INVALID_CODE',
    )
  })

  it('turns it off and renews the codes, which it answers as a list', async () => {
    const { factor, service: twoFactor } = service()

    factor.enabled = true

    expect((await twoFactor.renewCodes(FACTOR_PASSWORD))._unsafeUnwrap()).toEqual(RENEWED_CODES)
    expect((await twoFactor.disable(FACTOR_PASSWORD)).isOk()).toBe(true)
    expect(factor.enabled).toBe(false)
  })
})
