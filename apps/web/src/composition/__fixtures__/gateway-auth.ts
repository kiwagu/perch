import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type SignUpInput } from '@workspace/data'
import { type Locale, SUPPORTED_LOCALES } from '@workspace/i18n/translator'
import { identityIdFactory } from '@workspace/ids'
import { keepsPasswordRules } from '@workspace/kernel'

import type { EmailVerification, GatewayAuth, NamedDevice, SignedInDevice } from '../gateway-auth'

interface Account {
  readonly identity: SignedInDevice['identity']
  readonly password: string
  /** The account's own name, as it signed up. */
  readonly name: string
  /** The language the account signed up in. */
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
      readonly locale: string
    }
  | { readonly kind: 'sign-in'; readonly email: string; readonly device: NamedDevice }
  | { readonly kind: 'verify'; readonly token: string; readonly device: NamedDevice }
  | { readonly kind: 'resend'; readonly email: string }
  | { readonly kind: 'request-reset'; readonly email: string }
  | { readonly kind: 'reset'; readonly token: string }
  | { readonly kind: 'change-password'; readonly token: string; readonly device: string }
  | { readonly kind: 'change-email'; readonly email: string; readonly token: string }
  | { readonly kind: 'confirm'; readonly token: string }
  | { readonly kind: 'request-deletion'; readonly token: string; readonly device: string }
  | { readonly kind: 'delete'; readonly token: string }
  | { readonly kind: 'sign-out'; readonly token: string; readonly device: string }

export interface FakeGatewayAuth extends GatewayAuth {
  /** Every sign-up, sign-in, verification, resend and sign-out asked, oldest first. */
  readonly requests: FakeAuthRequest[]
  /** How the gateway answers the sign-out of each token from now on: it takes each one by default. */
  answerSignOut(answer: (token: string) => ResultAsync<void, DataError>): void
  /** The token of the latest verification link the gateway made for the account of `email`. */
  linkFor(email: string): string
  /** The tokens of the verification links mailed to the account of `email`, oldest first. */
  mailsTo(email: string): readonly string[]
  /** The identity of the account of `email`, as the gateway keeps it. */
  identityOf(email: string): AuthUser
  /** The token of the latest reset link the gateway made for the account of `email`. */
  resetLinkFor(email: string): string
  /** The token of the latest link that confirms the change of the account of `email` to a new one. */
  confirmationLinkFor(email: string): string
  /** The token of the latest link that deletes the account of `email`. */
  deletionLinkFor(email: string): string
  /**
   * Makes the account of `email` (or not any longer, with `false`) the only administrator of an
   * organisation with other members: a request to delete it, and the deletion itself, are then
   * refused as `data:LAST_ADMIN` and change nothing.
   */
  blockDeletion(email: string, blocked?: boolean): void
}

/** One of the app's languages, as the gateway takes a sign-up's: anything else is refused. */
const isLocale = (locale: string): locale is Locale =>
  SUPPORTED_LOCALES.some((supported) => supported === locale)

/**
 * The gateway's sign-up, sign-in, verification and sign-out without a network: accounts live in
 * memory, keyed and answered by their email in lower case as the gateway keeps it, and each
 * answer that signs a device in carries a new session token. A sign-up signs nothing in: a new
 * email makes an account not verified yet and a verification link, as its mail would carry; one
 * that has an account changes nothing; both answer alike. A sign-in with the right password of an
 * account not verified yet is refused as `data:EMAIL_NOT_VERIFIED`. The first exchange of any of
 * the account's links verifies it and signs the device in, a later one signs nothing in.
 */
export function fakeGatewayAuth(): FakeGatewayAuth {
  const accounts = new Map<string, Account>()
  /** The email of the account each verification link's token verifies. */
  const links = new Map<string, string>()
  /** The verification links' tokens mailed to each account, oldest first, by its email. */
  const mailed = new Map<string, string[]>()
  /** The email of the account each reset link's token sets a password for; only the newest works. */
  const resets = new Map<string, string>()
  /** The account and the new email of each confirmation link's token; only the newest works. */
  const confirmations = new Map<string, { readonly email: string; readonly next: string }>()
  /** The email of the account each deletion link's token deletes; only the newest works. */
  const deletions = new Map<string, string>()
  /** The emails of the accounts that are the only administrator of an organisation with others. */
  const onlyAdmins = new Set<string>()
  /** The email of the account each session token was given for. */
  const sessions = new Map<string, string>()
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
    mailed.set(email, [...(mailed.get(email) ?? []), link])
  }

  return {
    requests,
    answerSignOut: (answer) => {
      signOutAnswer = answer
    },
    linkFor: (email) => {
      const link = mailed.get(email.toLowerCase())?.at(-1)

      if (link === undefined) throw new Error('the gateway made no verification link for the email')

      return link
    },
    mailsTo: (email) => mailed.get(email.toLowerCase()) ?? [],
    confirmationLinkFor: (email) => {
      const link = [...confirmations].findLast(([, of]) => of.email === email.toLowerCase())?.[0]

      if (link === undefined) throw new Error('the gateway made no confirmation link for the email')

      return link
    },
    deletionLinkFor: (email) => {
      const link = [...deletions].findLast(([, of]) => of === email.toLowerCase())?.[0]

      if (link === undefined) throw new Error('the gateway made no deletion link for the email')

      return link
    },
    blockDeletion: (email, blocked = true) => {
      if (blocked) {
        onlyAdmins.add(email.toLowerCase())
      } else {
        onlyAdmins.delete(email.toLowerCase())
      }
    },
    resetLinkFor: (email) => {
      const link = [...resets].findLast(([, of]) => of === email.toLowerCase())?.[0]

      if (link === undefined) throw new Error('the gateway made no reset link for the email')

      return link
    },
    identityOf: (email) => {
      const account = accounts.get(email.toLowerCase())

      if (account === undefined) throw new Error('the gateway has no account of the email')

      return account.identity
    },
    signUp: (input) => {
      requests.push({ kind: 'sign-up', email: input.email, name: input.name, locale: input.locale })

      const email = input.email.toLowerCase()
      const { locale } = input

      if (!isLocale(locale)) {
        return errAsync(dataError('data:SIGN_UP_REJECTED', 'sign-up was rejected'))
      }

      if (!accounts.has(email)) {
        accounts.set(email, {
          identity: { id: identityIdFactory.create(), email },
          password: input.password,
          name: input.name,
          locale,
          verified: false,
        })
        mintLink(email)
      }

      return okAsync(undefined)
    },
    signIn: (input, device) => {
      requests.push({ kind: 'sign-in', email: input.email, device })

      const account = accounts.get(input.email.toLowerCase())

      if (account?.password !== input.password) {
        return errAsync(dataError('data:INVALID_CREDENTIALS', 'wrong email or password'))
      }

      if (!account.verified) {
        return errAsync(dataError('data:EMAIL_NOT_VERIFIED', 'the email is not verified yet'))
      }

      const given = token()

      sessions.set(given, account.identity.email)

      return okAsync({ identity: account.identity, token: given })
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

      const given = token()

      sessions.set(given, email)

      return okAsync({
        kind: 'signed-in',
        device: { identity: account.identity, token: given },
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
    requestPasswordReset: (email) => {
      requests.push({ kind: 'request-reset', email })

      const known = email.toLowerCase()

      if (accounts.has(known)) {
        // The newest link replaces the earlier ones.
        for (const [link, of] of resets) {
          if (of === known) resets.delete(link)
        }

        linked += 1
        resets.set(`reset-${linked}`, known)
      }

      return okAsync(undefined)
    },
    resetPassword: (link, password, session) => {
      requests.push({ kind: 'reset', token: link })

      const email = resets.get(link)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:LINK_INVALID', 'the gateway refused the link'))
      }

      // Only that mailbox got the link: the reset verifies the email too.
      resets.delete(link)
      accounts.set(email, { ...account, password, verified: true })

      // It ends every session of the account, the one presented with it among them when it was one.
      const signedOut = session !== undefined && sessions.get(session.token) === email

      for (const [given, of] of sessions) {
        if (of === email) {
          sessions.delete(given)
        }
      }

      return okAsync({ signedOut })
    },
    changePassword: (input, session) => {
      requests.push({ kind: 'change-password', token: session.token, device: session.device })

      const email = sessions.get(session.token)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:AUTH_FAILED', 'the gateway refused the session token'))
      }

      if (account.password !== input.currentPassword) {
        return errAsync(dataError('data:INVALID_CREDENTIALS', 'the current password is wrong'))
      }

      if (!keepsPasswordRules(input.password)) {
        return errAsync(dataError('data:PASSWORD_REJECTED', 'the new password breaks the rules'))
      }

      accounts.set(email, { ...account, password: input.password })

      return okAsync(undefined)
    },
    changeEmail: (input, session) => {
      requests.push({ kind: 'change-email', email: input.email, token: session.token })

      const email = sessions.get(session.token)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:AUTH_FAILED', 'the gateway refused the session token'))
      }

      if (account.password !== input.password) {
        return errAsync(dataError('data:INVALID_CREDENTIALS', 'the password is wrong'))
      }

      if (!input.email.includes('@')) {
        return errAsync(dataError('data:EMAIL_INVALID', 'the new email is not an email'))
      }

      const next = input.email.toLowerCase()

      // A taken email gets the same answer, and no link; a new link replaces the earlier one.
      if (!accounts.has(next)) {
        for (const [link, of] of confirmations) {
          if (of.email === email) confirmations.delete(link)
        }

        linked += 1
        confirmations.set(`confirm-${linked}`, { email, next })
      }

      return okAsync(undefined)
    },
    confirmEmail: (link) => {
      requests.push({ kind: 'confirm', token: link })

      const change = confirmations.get(link)
      const account = change === undefined ? undefined : accounts.get(change.email)

      if (change === undefined || account === undefined || accounts.has(change.next)) {
        return errAsync(dataError('data:LINK_INVALID', 'the gateway refused the link'))
      }

      // The account moves to its new email; its sessions stay.
      confirmations.delete(link)
      accounts.delete(change.email)
      accounts.set(change.next, {
        ...account,
        identity: { ...account.identity, email: change.next },
      })

      for (const [given, of] of sessions) {
        if (of === change.email) sessions.set(given, change.next)
      }

      return okAsync({ identity: account.identity.id, email: change.next })
    },
    requestAccountDeletion: (password, session) => {
      requests.push({ kind: 'request-deletion', token: session.token, device: session.device })

      const email = sessions.get(session.token)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:AUTH_FAILED', 'the gateway refused the session token'))
      }

      if (account.password !== password) {
        return errAsync(dataError('data:INVALID_CREDENTIALS', 'the password is wrong'))
      }

      if (onlyAdmins.has(email)) {
        return errAsync(dataError('data:LAST_ADMIN', 'the account is the last administrator'))
      }

      // The newest link replaces the earlier ones.
      for (const [link, of] of deletions) {
        if (of === email) deletions.delete(link)
      }

      linked += 1
      deletions.set(`delete-${linked}`, email)

      return okAsync(undefined)
    },
    deleteAccount: (link) => {
      requests.push({ kind: 'delete', token: link })

      const email = deletions.get(link)
      const account = email === undefined ? undefined : accounts.get(email)

      if (email === undefined || account === undefined) {
        return errAsync(dataError('data:LINK_INVALID', 'the gateway refused the link'))
      }

      if (onlyAdmins.has(email)) {
        return errAsync(dataError('data:LAST_ADMIN', 'the account is the last administrator'))
      }

      // The account goes for good, its sessions and its links with it.
      deletions.delete(link)
      accounts.delete(email)

      for (const [given, of] of sessions) {
        if (of === email) sessions.delete(given)
      }

      return okAsync({ identity: account.identity.id })
    },
    signOut: (signedOut, device) => {
      requests.push({ kind: 'sign-out', token: signedOut, device })

      return signOutAnswer(signedOut)
    },
  }
}

/** The device on which `verifiedElsewhere` opens a link: not the test's own. */
const ELSEWHERE: NamedDevice = { id: 'verified-elsewhere', label: 'Edge on Windows' }

/**
 * Signs `input` up at `auth` and opens its verification link on another device, as a person does
 * there: the account then signs in anywhere. That device's session token stays at the gateway.
 */
export function verifiedElsewhere(
  auth: FakeGatewayAuth,
  input: SignUpInput,
): ResultAsync<AuthUser, DataError> {
  return auth
    .signUp(input)
    .andThen(() => auth.verifyEmail(auth.linkFor(input.email), ELSEWHERE))
    .andThen((verified) =>
      verified.kind === 'signed-in'
        ? okAsync(verified.device.identity)
        : errAsync(dataError('data:AUTH_FAILED', 'the link was opened before')),
    )
}
