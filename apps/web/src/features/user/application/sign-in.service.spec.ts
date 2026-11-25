import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { identityIdFactory } from '@workspace/ids'

import type { SignInResult } from '../../../platform/session.port'

import { SignInService } from './sign-in.service'

const FORM = { email: 'ann@example.test', password: 'Secret-ann1', name: '', locale: 'en' as const }
const STEP = { challenge: 'challenge-1', email: 'ann@example.test' }
const USER = { id: identityIdFactory.create(), email: 'ann@example.test' }

/** The service over a session whose every step of signing in answers `answer`. */
function answering(answer: SignInResult): SignInService {
  return new SignInService({
    signIn: () => okAsync(answer),
    confirmSignIn: () => okAsync(answer),
    signInWithPasskey: () => okAsync(answer),
    signUp: () => okAsync(undefined),
    resendVerification: () => okAsync(undefined),
  })
}

describe('SignInService', () => {
  it('refuses a sign-in the session found at the limit of devices as data:DEVICE_LIMIT, naming no account', async () => {
    const refused = (
      await answering({ kind: 'device-limit' }).signIn(FORM, false)
    )._unsafeUnwrapErr()

    expect(refused).toMatchObject({ code: 'data:DEVICE_LIMIT' })
    expect(refused).not.toHaveProperty('consentFor')
  })

  it('refuses a code step at the limit of devices the same way', async () => {
    const refused = (
      await answering({ kind: 'device-limit' }).confirmSignIn(STEP, '123456', false)
    )._unsafeUnwrapErr()

    expect(refused).toMatchObject({ code: 'data:DEVICE_LIMIT' })
    expect(refused).not.toHaveProperty('consentFor')
  })

  it('refuses a passkey sign-in at the limit of devices naming the account it asked about', async () => {
    const refused = (
      await answering({ kind: 'device-limit', consentFor: 'idn_ann' }).signInWithPasskey()
    )._unsafeUnwrapErr()

    expect(refused).toMatchObject({ code: 'data:DEVICE_LIMIT', consentFor: 'idn_ann' })
  })

  it('answers a device signed in and a code asked as the session does', async () => {
    const signedIn = { kind: 'signed-in', user: USER } as const
    const asked = { kind: 'code-required', ...STEP } as const

    expect((await answering(signedIn).signIn(FORM, false))._unsafeUnwrap()).toEqual(signedIn)
    expect((await answering(asked).signIn(FORM, false))._unsafeUnwrap()).toEqual(asked)
    expect((await answering(signedIn).confirmSignIn(STEP, '123456', true))._unsafeUnwrap()).toEqual(
      signedIn,
    )
    expect((await answering(signedIn).signInWithPasskey('idn_ann'))._unsafeUnwrap()).toEqual(
      signedIn,
    )
  })
})
