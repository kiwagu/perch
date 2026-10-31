import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { Locale } from '@workspace/i18n/translator'
import { identityIdFactory } from '@workspace/ids'

import type { EmailVerification, GatewayAuth, NamedDevice, SignedInDevice } from '../gateway-auth'

interface Account {
  readonly identity: SignedInDevice['identity']
  readonly password: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The language the account signed up in: the gateway's default, as no sign-up names one yet. */
  readonly locale: Locale
  /** Whether a link of the account was exchanged. */
  readonly verified: boolean
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
  | { readonly kind: 'verify'; readonly token: string; readonly device: NamedDevice }
  | { readonly kind: 'resend'; readonly email: string }
  | { readonly kind: 'sign-out'; readonly token: string; readonly device: string }

export interface FakeGatewayAuth extends GatewayAuth {
  /** Every sign-up, sign-in, verification, resend and sign-out asked, oldest first. */
  readonly requests: FakeAuthRequest[]
  /** How the gateway answers the sign-out of each token from now on: it takes each one by default. */
  answerSignOut(answer: (token: string) => ResultAsync<void, DataError>): void
  /** The token of the latest verification link the gateway made for the account of `email`. */
  linkFor(email: string): string
}

/**
 * The gateway's sign-up, sign-in, verification and sign-out without a network: accounts live in
 * memory, keyed and answered by their email in lower case as the gateway keeps it, and each
 * answer that signs a device in carries a new session token. A sign-up still signs the device in,
 * and also makes the account a verification link, as its mail would carry; the first exchange of
 * any of the account's links verifies it and signs the device in, a later one signs nothing in.
 */
export function fakeGatewayAuth(): FakeGatewayAuth {
  const accounts = new Map<string, Account>()
  /** The email of the account each verification link's token verifies. */
  const links = new Map<string, string>()
  /** The latest verification link's token of each account, by its email. */
  const latestLinks = new Map<string, string>()
  const requests: FakeAuthRequest[] = []
  let issued = 0
  let linked = 0
  let signOutAnswer = (_token: string): ResultAsync<void, DataError> => okAsync(undefined)
  const token = () => {
    issued += 1

    return `token-${issued}`
  }
  const mintLink = (email: string) => {
    linked += 1

    const link = `link-${linked}`

    links.set(link, email)
    latestLinks.set(email, link)
  }

  return {
    requests,
    answerSignOut: (answer) => {
      signOutAnswer = answer
    },
    linkFor: (email) => {
      const link = latestLinks.get(email.toLowerCase())

      if (link === undefined) throw new Error('the gateway made no verification link for the email')

      return link
    },
    signUp: (input, device) => {
      requests.push({ kind: 'sign-up', email: input.email, name: input.name, device })

      const email = input.email.toLowerCase()

      if (accounts.has(email)) {
        return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
      }

      const identity = { id: identityIdFactory.create(), email }

      accounts.set(email, {
        identity,
        password: input.password,
        name: input.name,
        locale: 'en',
        verified: false,
      })
      mintLink(email)

      return okAsync({ identity, token: token() })
    },
    signIn: (input, device) => {
      requests.push({ kind: 'sign-in', email: input.email, device })

      const account = accounts.get(input.email.toLowerCase())

      return account?.password === input.password
        ? okAsync({ identity: account.identity, token: token() })
        : errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
    },
    verifyEmail: (link, device): ResultAsync<EmailVerification, DataError> => {
      requests.push({ kind: 'verify', token: link, device })

      const email = links.get(link)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:LINK_INVALID', 'the gateway refused the link'))
      }

      if (account.verified) {
        return okAsync({ kind: 'verified-before' })
      }

      accounts.set(email, { ...account, verified: true })

      return okAsync({
        kind: 'signed-in',
        device: { identity: account.identity, token: token() },
        account: { name: account.name, locale: account.locale },
      })
    },
    resendVerification: (email) => {
      requests.push({ kind: 'resend', email })

      const account = accounts.get(email.toLowerCase())

      if (account && !account.verified) {
        mintLink(account.identity.email)
      }

      return okAsync(undefined)
    },
    signOut: (signedOut, device) => {
      requests.push({ kind: 'sign-out', token: signedOut, device })

      return signOutAnswer(signedOut)
    },
  }
}
