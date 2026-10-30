import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { GatewayAuth, KeyPair, NamedDevice, SignedInDevice } from '../gateway-auth'

interface Account {
  readonly device: Omit<SignedInDevice, 'tokens'>
  readonly password: string
}

/** A request the fake gateway took, in the order it came. */
export type FakeAuthRequest =
  | { readonly kind: 'sign-up' | 'sign-in'; readonly email: string; readonly device: NamedDevice }
  | { readonly kind: 'sign-out'; readonly pair: KeyPair; readonly device: string }

export interface FakeGatewayAuth extends GatewayAuth {
  /** Every sign-up, sign-in and sign-out asked, oldest first. */
  readonly requests: FakeAuthRequest[]
  /** How the gateway answers the sign-out of each pair from now on: it takes each one by default. */
  answerSignOut(answer: (pair: KeyPair) => ResultAsync<void, DataError>): void
}

/**
 * The gateway's sign-up, sign-in and sign-out without a network: accounts live in memory, keyed
 * and answered by their email in lower case as the gateway keeps it, each answer carries new keys
 * and every account belongs to `memberships`.
 */
export function fakeGatewayAuth(memberships: readonly Membership[] = []): FakeGatewayAuth {
  const accounts = new Map<string, Account>()
  const requests: FakeAuthRequest[] = []
  let issued = 0
  let signOutAnswer = (_pair: KeyPair): ResultAsync<void, DataError> => okAsync(undefined)
  const keys = () => {
    issued += 1

    return { access: `access-${issued}`, refresh: `refresh-${issued}` }
  }

  return {
    requests,
    answerSignOut: (answer) => {
      signOutAnswer = answer
    },
    signUp: (input, device) => {
      requests.push({ kind: 'sign-up', email: input.email, device })

      const email = input.email.toLowerCase()

      if (accounts.has(email)) {
        return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
      }

      const identity = { id: identityIdFactory.create(), email }

      accounts.set(email, { device: { identity, memberships }, password: input.password })

      return okAsync({ identity, tokens: keys(), memberships })
    },
    signIn: (input, device) => {
      requests.push({ kind: 'sign-in', email: input.email, device })

      const account = accounts.get(input.email.toLowerCase())

      return account?.password === input.password
        ? okAsync({ ...account.device, tokens: keys() })
        : errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
    },
    signOut: (pair, device) => {
      requests.push({ kind: 'sign-out', pair, device })

      return signOutAnswer(pair)
    },
  }
}
