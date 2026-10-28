import { describe, expect, it } from 'vitest'

import { issuedAtOf, namesOtherScope } from './token-claims'

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

describe('namesOtherScope', () => {
  const scope = { namespace: 'app', database: 'directory', access: 'identity' }

  /** The payload of a token whose scope claims go by `names` and hold `values`. */
  function scopedBy(
    names: readonly [string, string, string],
    values: readonly [unknown, unknown, unknown] = ['app', 'directory', 'identity'],
  ): string {
    return JSON.stringify({
      iat: 1760000000,
      [names[0]]: values[0],
      [names[1]]: values[1],
      [names[2]]: values[2],
    })
  }

  /** Every set of names the database reads a token's scope by. */
  const spellings = [
    ['NS', 'DB', 'AC'],
    ['ns', 'db', 'ac'],
    ['https://surrealdb.com/ns', 'https://surrealdb.com/db', 'https://surrealdb.com/ac'],
    [
      'https://surrealdb.com/namespace',
      'https://surrealdb.com/database',
      'https://surrealdb.com/access',
    ],
  ] as const

  it('finds the scope a token was issued for its own, whatever names its claims go by', () => {
    for (const names of spellings) {
      expect(namesOtherScope(tokenWith(scopedBy(names)), scope)).toBe(false)
    }
  })

  it('finds another namespace, database or access method under any name the database reads', () => {
    for (const names of spellings) {
      for (const values of [
        ['other', 'directory', 'identity'],
        ['app', 't_acme', 'identity'],
        ['app', 'directory', 'elsewhere'],
        [1, 'directory', 'identity'],
      ] as const) {
        expect(namesOtherScope(tokenWith(scopedBy(names, values)), scope)).toBe(true)
      }
    }
  })

  it('finds another scope in a token that names one part under two names, one of them another', () => {
    const payload = '{"NS":"app","DB":"directory","AC":"identity","ac":"elsewhere"}'

    expect(namesOtherScope(tokenWith(payload), scope)).toBe(true)
  })

  it('finds another scope in a token that names its scope only in part', () => {
    for (const payload of [
      '{"DB":"directory","AC":"identity"}',
      '{"NS":"app","AC":"identity"}',
      '{"ns":"app","db":"directory"}',
      '{"https://surrealdb.com/ac":"identity"}',
    ]) {
      expect(namesOtherScope(tokenWith(payload), scope)).toBe(true)
    }
  })

  it('leaves a token that names no scope, or anything that is not a token, to the database', () => {
    const payload = '{"NS":"other","DB":"directory","AC":"identity"}'

    for (const access of [
      tokenWith('{"iat":1760000000,"Ns":"other"}'),
      tokenWith('{}'),
      tokenWith('not json'),
      tokenWith('["NS"]'),
      '',
      'stale',
      'a.b',
      `${tokenWith(payload)}.extra`,
    ]) {
      expect(namesOtherScope(access, scope)).toBe(false)
    }
  })
})
