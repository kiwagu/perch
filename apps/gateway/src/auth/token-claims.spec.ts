import { describe, expect, it } from 'vitest'

import { issuedAtOf } from './token-claims'

/** A token of the JWT form whose payload is `payload`, encoded; the signature is not checked. */
function tokenWith(payload: string): string {
  const header = Buffer.from('{"alg":"HS512","typ":"JWT"}').toString('base64url')

  return `${header}.${Buffer.from(payload).toString('base64url')}.signature`
}

describe('issuedAtOf', () => {
  it('reads when an access token was issued: its iat, a whole second', () => {
    expect(issuedAtOf(tokenWith('{"iat":1760000000,"exp":1760000900,"ID":"identity:x"}'))).toEqual(
      new Date(1_760_000_000_000),
    )
  })

  it('answers undefined for a token whose payload names no whole second it was issued in', () => {
    for (const payload of ['{}', '{"iat":"1760000000"}', '{"iat":1760000000.5}', 'not json']) {
      expect(issuedAtOf(tokenWith(payload))).toBeUndefined()
    }
  })

  it('answers undefined for anything that is not a token of three segments', () => {
    for (const access of ['', 'stale', 'a.b', `${tokenWith('{"iat":1760000000}')}.extra`]) {
      expect(issuedAtOf(access)).toBeUndefined()
    }
  })
})
