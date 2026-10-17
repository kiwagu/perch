import { errAsync, okAsync } from 'neverthrow'

import { dataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'

import type { GatewayAuth, SignedInDevice } from '../gateway-auth'

interface Account {
  readonly device: Omit<SignedInDevice, 'tokens'>
  readonly password: string
}

/** The gateway's sign-up and sign-in without a network: accounts live in memory, each answer carries new keys. */
export function fakeGatewayAuth(): GatewayAuth {
  const accounts = new Map<string, Account>()
  let issued = 0
  const keys = () => {
    issued += 1

    return { access: `access-${issued}`, refresh: `refresh-${issued}` }
  }

  return {
    signUp: (input) => {
      if (accounts.has(input.email)) {
        return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
      }

      const identity = { id: identityIdFactory.create(), email: input.email }

      accounts.set(input.email, { device: { identity }, password: input.password })

      return okAsync({ identity, tokens: keys() })
    },
    signIn: (input) => {
      const account = accounts.get(input.email)

      return account?.password === input.password
        ? okAsync({ ...account.device, tokens: keys() })
        : errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
    },
  }
}
