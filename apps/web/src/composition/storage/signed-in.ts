/** Who is signed in on this browser, and the session token the device presents to the gateway. */

import type { AuthUser } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { SignedInDevice } from '../gateway-auth'

import { ACCOUNT_START_KEY } from './account-start'
import type { KeyValueStorage } from './key-value'
import { forgetMemberships, saveMemberships, TENANT_KEY } from './memberships'
import { forgetRoles } from './roles'

/** Who is signed in on this browser; the tabs follow it. */
export const IDENTITY_KEY = 'perch.session.identity'

/**
 * The session token the gateway issued the device at its sign-in, kept with the identity it was
 * issued to (`{ identity, token }`), so a token and its owner are read in one step; it lives until
 * a sign-out.
 */
export const TOKEN_KEY = 'perch.session.token'

/** The refresh key an older build kept beside its access token; nothing reads or writes it now. */
const OLD_REFRESH_KEY = 'perch.session.refresh'

/**
 * The email an email confirmation gave the signed-in identity, kept under a key of the session the
 * confirmation was asked in (`perch.session.email.<tag of its token>`) and read over the
 * identity's record while that session lasts: a tab hears another tab's writes late, so a
 * confirmation answered after another tab signed the identity out, or signed it in again, writes
 * under the ended session's key, beside nothing the current session reads. It never brings the
 * identity back without its token, nor stands over, or replaces, what a later session has. A
 * sign-in in the tab that asked writes its token before its identity, so a tab that has the
 * identity has its token too.
 */
const EMAIL_KEY_PREFIX = 'perch.session.email.'

/**
 * A short tag of `token` (the 53-bit cyrb53 hash), naming its session in a key without spelling
 * out the token itself.
 */
function tagOf(token: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57

  for (let i = 0; i < token.length; i++) {
    const code = token.charCodeAt(i)

    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

const emailKeyOf = (token: string): string => `${EMAIL_KEY_PREFIX}${tagOf(token)}`

const savedIdentitySchema = z.object({ id: idSchemas.identity.schema, email: z.string() })

const confirmedEmailSchema = z.object({ identity: idSchemas.identity.schema, email: z.string() })

const savedTokenSchema = z.object({ identity: idSchemas.identity.schema, token: z.string() })

/** The session this browser keeps: its token and the identity it was issued to. */
export type KeptSession = z.output<typeof savedTokenSchema>

/** A device whose sign-in is whole: who it is, its session token and the memberships it read. */
export interface KeptDevice extends SignedInDevice {
  readonly memberships: readonly Membership[]
}

/** What `TOKEN_KEY` keeps: the session `token` with the `identity` it was issued to. */
export function tokenRecord(identity: AuthUser['id'], token: string): string {
  return JSON.stringify({ identity, token })
}

/**
 * Keeps the device a sign-in made whole, in one step: the token first, which names the identity
 * should a later write break (`forgetDevice` then knows whose records to forget), then the
 * memberships, the identity last, so a tab that follows the identity finds the rest saved
 * already. The email a confirmation kept for the session it replaces goes.
 */
export function saveDevice(storage: KeyValueStorage, device: KeptDevice): void {
  const replaced = savedSession(storage)

  if (replaced) {
    storage.remove(emailKeyOf(replaced.token))
  }

  storage.set(TOKEN_KEY, tokenRecord(device.identity.id, device.token))
  saveMemberships(storage, device.identity.id, device.memberships)
  storage.set(
    IDENTITY_KEY,
    JSON.stringify({ id: device.identity.id, email: device.identity.email }),
  )
}

/**
 * Keeps the new email of `identity`, as its email's confirmation answered, for the session the
 * confirmation was asked in (`asked`, the session this browser kept then; now by default), when
 * that session is the identity's: never in the identity's record.
 */
export function saveIdentityEmail(
  storage: KeyValueStorage,
  identity: AuthUser['id'],
  email: string,
  asked: KeptSession | undefined = savedSession(storage),
): void {
  if (asked?.identity === identity) {
    storage.set(emailKeyOf(asked.token), JSON.stringify({ identity, email }))
  }
}

/**
 * The identity signed in on this browser, with the email a confirmation asked in its current
 * session gave it, when there is one; a kept value that does not describe one is none.
 */
export function savedIdentity(storage: KeyValueStorage): AuthUser | undefined {
  const saved = read(storage, IDENTITY_KEY, savedIdentitySchema)
  const session = savedSession(storage)
  const confirmed =
    saved !== undefined && session?.identity === saved.id
      ? read(storage, emailKeyOf(session.token), confirmedEmailSchema)
      : undefined

  return saved && confirmed?.identity === saved.id ? { ...saved, email: confirmed.email } : saved
}

/** The session this browser keeps, if it keeps one, whoever it is of. */
export function savedSession(storage: KeyValueStorage): KeptSession | undefined {
  return read(storage, TOKEN_KEY, savedTokenSchema)
}

/** The session token the device presents to the gateway, if it keeps one, whoever it is of. */
export function savedToken(storage: KeyValueStorage): string | undefined {
  return savedSession(storage)?.token
}

/**
 * The session token the device keeps for `identity`; none while it keeps none, or another
 * identity's. The calls made for an identity read its token here, with its owner in one step.
 */
export function savedTokenOf(
  storage: KeyValueStorage,
  identity: AuthUser['id'],
): string | undefined {
  const saved = read(storage, TOKEN_KEY, savedTokenSchema)

  return saved?.identity === identity ? saved.token : undefined
}

/** The record kept at `key`; a kept value that does not describe one is none. */
function read<T>(storage: KeyValueStorage, key: string, schema: z.ZodType<T>): T | undefined {
  const text = storage.get(key)

  if (text === undefined) {
    return undefined
  }

  try {
    const parsed = schema.safeParse(JSON.parse(text))

    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/**
 * Forgets who is signed in and the token; the other tabs hear the identity go. The memberships,
 * the email a confirmation kept and the platform roles of the identity signed out go with it
 * (the records of other identities stay): the identity saved, or the one the token names when a
 * sign-in's save broke before the identity. The inventory of the organisation databases stays: the databases may stay too. So do
 * the tokens left to sign out. A refresh key an older build kept goes too, and the start of the
 * account this browser kept to finish: signed out, the browser no longer knows what the account
 * has.
 */
export function forgetDevice(storage: KeyValueStorage): void {
  const session = savedSession(storage)
  const signedOut = savedIdentity(storage)?.id ?? session?.identity

  storage.remove(ACCOUNT_START_KEY)
  storage.remove(TOKEN_KEY)
  storage.remove(OLD_REFRESH_KEY)
  storage.remove(IDENTITY_KEY)
  storage.remove(TENANT_KEY)

  if (session) {
    storage.remove(emailKeyOf(session.token))
  }

  if (signedOut) {
    forgetMemberships(storage, signedOut)
    forgetRoles(storage, signedOut)
  }
}
