import { describe, expect, it } from 'vitest'

import { issuedAtOf, scopeOf } from './token-claims'

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

describe('scopeOf', () => {
  it('reads the namespace, database and access method a token was issued for', () => {
    expect(
      scopeOf(tokenWith('{"iat":1760000000,"NS":"app","DB":"directory","AC":"identity"}')),
    ).toEqual({ namespace: 'app', database: 'directory', access: 'identity' })
  })

  it('answers undefined for a token whose payload names no namespace, database and access method', () => {
    for (const payload of [
      '{}',
      '{"DB":"directory","AC":"identity"}',
      '{"NS":"app","AC":"identity"}',
      '{"NS":"app","DB":"directory"}',
      '{"NS":1,"DB":"directory","AC":"identity"}',
      'not json',
    ]) {
      expect(scopeOf(tokenWith(payload))).toBeUndefined()
    }
  })

  it('answers undefined for anything that is not a token of three segments', () => {
    const payload = '{"NS":"app","DB":"directory","AC":"identity"}'

    for (const access of ['', 'stale', 'a.b', `${tokenWith(payload)}.extra`]) {
      expect(scopeOf(access)).toBeUndefined()
    }
  })
})
