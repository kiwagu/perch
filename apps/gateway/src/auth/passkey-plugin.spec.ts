import { APIError } from 'better-auth/api'
import { describe, expect, it } from 'vitest'

import {
  passkeyPlugin,
  refuseUnverifiedAuthentication,
  refuseUnverifiedRegistration,
} from './passkey-plugin'

/** The refusal `check` threw, or none when it passed. */
function refusalOf(check: () => void): unknown {
  try {
    check()
  } catch (refusal) {
    return refusal instanceof APIError ? [refusal.statusCode, refusal.body?.code] : refusal
  }

  return undefined
}

describe('passkeyPlugin', () => {
  it("asks every passkey for a discoverable credential and its user's verification, on the front's own site", () => {
    const { options } = passkeyPlugin('https://perch.example.test')

    expect([options?.rpID, options?.rpName, options?.origin]).toEqual([
      'perch.example.test',
      'Perch',
      'https://perch.example.test',
    ])
    expect(options?.authenticatorSelection).toEqual({
      residentKey: 'required',
      userVerification: 'required',
    })
    expect(options?.registration?.afterVerification).toBe(refuseUnverifiedRegistration)
    expect(options?.authentication?.afterVerification).toBe(refuseUnverifiedAuthentication)
  })

  it('refuses a registration whose authenticator did not verify its user, before the passkey is kept', () => {
    expect(
      refusalOf(() =>
        refuseUnverifiedRegistration({
          verification: { registrationInfo: { userVerified: false } },
        }),
      ),
    ).toEqual([400, 'USER_NOT_VERIFIED'])
    expect(refusalOf(() => refuseUnverifiedRegistration({ verification: {} }))).toEqual([
      400,
      'USER_NOT_VERIFIED',
    ])
    expect(
      refusalOf(() =>
        refuseUnverifiedRegistration({
          verification: { registrationInfo: { userVerified: true } },
        }),
      ),
    ).toBeUndefined()
  })

  it('refuses a sign-in whose authenticator did not verify its user, before a session is written', () => {
    expect(
      refusalOf(() =>
        refuseUnverifiedAuthentication({
          verification: { authenticationInfo: { userVerified: false } },
        }),
      ),
    ).toEqual([400, 'USER_NOT_VERIFIED'])
    expect(
      refusalOf(() =>
        refuseUnverifiedAuthentication({
          verification: { authenticationInfo: { userVerified: true } },
        }),
      ),
    ).toBeUndefined()
  })
})
