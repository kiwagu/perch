import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'

import { secondStepActors } from './second-step-actors'

describe('the actors of the second steps', () => {
  const asked: unknown[] = []
  const actors = secondStepActors({
    confirmSignIn: (step, code, signOutOldest) => {
      asked.push({ step, code, signOutOldest })

      return okAsync({ kind: 'device-limit' })
    },
    signInWithPasskey: (signOutOldestFor) => {
      asked.push({ signOutOldestFor })

      return okAsync({ kind: 'device-limit' })
    },
  })

  it('tells a code step that is not under way that the sign-in is over, asking nothing', async () => {
    const confirming = createActor(actors['platform.confirm-sign-in'], {
      input: { step: undefined, code: '123456', signOutOldest: false },
    })

    confirming.start()

    await expect(toPromise(confirming)).rejects.toMatchObject({ code: 'data:CODE_EXPIRED' })
    expect(asked).toEqual([])
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
