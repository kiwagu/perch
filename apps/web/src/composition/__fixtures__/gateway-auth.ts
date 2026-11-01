import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { GatewayAuth, NamedDevice, SignedInDevice } from '../gateway-auth'

interface Account {
  readonly identity: SignedInDevice['identity']
  readonly password: string
}

/** A request the fake gateway took, in the order it came. */
export type FakeAuthRequest =
  | {
      readonly kind: 'sign-up'
      readonly email: string
      readonly name: string
      readonly device: NamedDevice
    }
  | { readonly kind: 'sign-in'; readonly email: string; readonly device: NamedDevice }
  | { readonly kind: 'sign-out'; readonly token: string; readonly device: string }

export interface FakeGatewayAuth extends GatewayAuth {
  /** Every sign-up, sign-in and sign-out asked, oldest first. */
  readonly requests: FakeAuthRequest[]
  /** How the gateway answers the sign-out of each token from now on: it takes each one by default. */
  answerSignOut(answer: (token: string) => ResultAsync<void, DataError>): void
}

/**
 * The gateway's sign-up, sign-in and sign-out without a network: accounts live in memory, keyed
 * and answered by their email in lower case as the gateway keeps it, and each answer carries a
 * new session token.
 */
export function fakeGatewayAuth(): FakeGatewayAuth {
  const accounts = new Map<string, Account>()
  const requests: FakeAuthRequest[] = []
  let issued = 0
  let signOutAnswer = (_token: string): ResultAsync<void, DataError> => okAsync(undefined)
  const token = () => {
    issued += 1

    return `token-${issued}`
  }

  return {
    requests,
    answerSignOut: (answer) => {
      signOutAnswer = answer
    },
    signUp: (input, device) => {
      requests.push({ kind: 'sign-up', email: input.email, name: input.name, device })

      const email = input.email.toLowerCase()

      if (accounts.has(email)) {
        return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
      }

      const identity = { id: identityIdFactory.create(), email }

      accounts.set(email, { identity, password: input.password })

      return okAsync({ identity, token: token() })
    },
    signIn: (input, device) => {
      requests.push({ kind: 'sign-in', email: input.email, device })

      const account = accounts.get(input.email.toLowerCase())

      return account?.password === input.password
        ? okAsync({ identity: account.identity, token: token() })
        : errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
    },
    signOut: (signedOut, device) => {
      requests.push({ kind: 'sign-out', token: signedOut, device })

      return signOutAnswer(signedOut)
    },
  }
}
