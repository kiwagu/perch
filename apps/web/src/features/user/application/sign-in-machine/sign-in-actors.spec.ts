import { okAsync } from 'neverthrow'
import { beforeEach, describe, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'

import { signInActors } from './sign-in-actors'

/** What every stubbed step of signing in answers: a code asked, which no actor reads. */
const ASKED = {
  kind: 'code-required',
  challenge: 'challenge-1',
  email: 'ann@example.test',
} as const

describe('the actors that sign in', () => {
  const asked: unknown[] = []
  const actors = signInActors({
    signIn: (form, signOutOldest) => {
      asked.push({ form, signOutOldest })

      return okAsync(ASKED)
    },
    confirmSignIn: (step, code, signOutOldest) => {
      asked.push({ step, code, signOutOldest })

      return okAsync(ASKED)
    },
    signInWithPasskey: (signOutOldestFor) => {
      asked.push({ signOutOldestFor })

      return okAsync(ASKED)
    },
  })

  beforeEach(() => {
    asked.length = 0
  })

  it('tells a code step that is not under way that the sign-in is over, asking nothing', async () => {
    const confirming = createActor(actors['platform.confirm-sign-in'], {
      input: { step: undefined, code: '123456', signOutOldest: false },
    })

    confirming.start()

    await expect(toPromise(confirming)).rejects.toMatchObject({ code: 'data:CODE_EXPIRED' })
    expect(asked).toEqual([])
  })

  it('tells a sign-in with no attempt under way that it failed, asking nothing', async () => {
    const signing = createActor(actors['platform.sign-in'], {
      input: { form: undefined, signOutOldest: true },
    })

    signing.start()

    await expect(toPromise(signing)).rejects.toMatchObject({ code: 'data:AUTH_FAILED' })
    expect(asked).toEqual([])
  })

  it('signs in with the form of the attempt it is given', async () => {
    const form = {
      email: 'ann@example.test',
      password: 'Secret-ann1',
      name: '',
      locale: 'en' as const,
    }
    const signing = createActor(actors['platform.sign-in'], {
      input: { form, signOutOldest: true },
    })

    signing.start()
    await toPromise(signing)

    expect(asked).toEqual([{ form, signOutOldest: true }])
  })

  it('takes the code at the step it is given, and asks the passkey for the account it names', async () => {
    const step = { challenge: 'challenge-1', email: 'ann@example.test' }
    const confirming = createActor(actors['platform.confirm-sign-in'], {
      input: { step, code: '123456', signOutOldest: true },
    })
    const keying = createActor(actors['platform.sign-in-passkey'], {
      input: { signOutOldestFor: 'idn_ann' },
    })

    confirming.start()
    keying.start()
    await toPromise(confirming)
    await toPromise(keying)

    expect(asked).toEqual([
      { step, code: '123456', signOutOldest: true },
      { signOutOldestFor: 'idn_ann' },
    ])
  })
})
