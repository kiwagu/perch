import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import { fakeSession } from '../../platform/__fixtures__/session'
import type { SignInResult } from '../../platform/session.port'

import { seedSession } from './session'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }

const credentials = { email: ann.email, password: 'Pass-word-1' }

/** A seed session over a session whose sign-in answers `result`. */
const answering = (result: SignInResult) =>
  seedSession({ ...fakeSession().session, signIn: () => okAsync<SignInResult, DataError>(result) })

describe('the seed client’s session', () => {
  it('unwraps a signed-in answer to the bare user', async () => {
    const signedIn = answering({ kind: 'signed-in', user: ann })

    expect((await signedIn.signIn(credentials))._unsafeUnwrap()).toEqual(ann)
  })

  it('keeps the error a sign-in past the limit of devices always was', async () => {
    const limited = answering({ kind: 'device-limit' })

    expect((await limited.signIn(credentials))._unsafeUnwrapErr().code).toBe('data:DEVICE_LIMIT')
  })

  it('refuses a sign-in that asks for a code as a seeding error, naming no challenge', async () => {
    const asking = answering({ kind: 'code-required', challenge: 'challenge-1', email: ann.email })
    const refused = (await asking.signIn(credentials))._unsafeUnwrapErr()

    expect(refused.code).toBe('data:AUTH_FAILED')
    expect(JSON.stringify(refused)).not.toContain('challenge-1')
  })
})
