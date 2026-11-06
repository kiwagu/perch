/** Who is signed in on this browser, and the session token the device presents to the gateway. */

import type { AuthUser } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { SignedInDevice } from '../gateway-auth'

import { ACCOUNT_START_KEY } from './account-start'
import type { KeyValueStorage } from './key-value'
import { MEMBERSHIPS_KEY, saveMemberships, TENANT_KEY } from './memberships'

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

const savedIdentitySchema = z.object({ id: idSchemas.identity.schema, email: z.string() })

const savedTokenSchema = z.object({ identity: idSchemas.identity.schema, token: z.string() })

/** A device whose sign-in is whole: who it is, its session token and the memberships it read. */
export interface KeptDevice extends SignedInDevice {
  readonly memberships: readonly Membership[]
}

/** What `TOKEN_KEY` keeps: the session `token` with the `identity` it was issued to. */
export function tokenRecord(identity: AuthUser['id'], token: string): string {
  return JSON.stringify({ identity, token })
}

/**
 * Keeps the device a sign-in made whole, in one step: the memberships and the token first, the
 * identity last, so a tab that follows the identity finds the rest saved already.
 */
export function saveDevice(storage: KeyValueStorage, device: KeptDevice): void {
  saveMemberships(storage, device.identity.id, device.memberships)
  storage.set(TOKEN_KEY, tokenRecord(device.identity.id, device.token))
  storage.set(
    IDENTITY_KEY,
    JSON.stringify({ id: device.identity.id, email: device.identity.email }),
  )
}

/**
 * Keeps the new email of `identity` while it is the one signed in on this browser, as its email's
 * confirmation answered; the tabs hear the identity's record change, and stay with it.
 */
export function saveIdentityEmail(
  storage: KeyValueStorage,
  identity: AuthUser['id'],
  email: string,
): void {
  if (savedIdentity(storage)?.id === identity) {
    storage.set(IDENTITY_KEY, JSON.stringify({ id: identity, email }))
  }
}

/** The identity signed in on this browser; a kept value that does not describe one is none. */
export function savedIdentity(storage: KeyValueStorage): AuthUser | undefined {
  return read(storage, IDENTITY_KEY, savedIdentitySchema)
}

/** The session token the device presents to the gateway, if it keeps one, whoever it is of. */
export function savedToken(storage: KeyValueStorage): string | undefined {
  return read(storage, TOKEN_KEY, savedTokenSchema)?.token
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
 * Forgets who is signed in and the token; the other tabs hear the identity go. The inventory of
 * the organisation databases stays: the databases may stay too. So do the tokens left to sign
 * out. A refresh key an older build kept goes too, and the start of the account this browser kept
 * to finish: signed out, the browser no longer knows what the account has.
 */
export function forgetDevice(storage: KeyValueStorage): void {
  storage.remove(ACCOUNT_START_KEY)
  storage.remove(TOKEN_KEY)
  storage.remove(OLD_REFRESH_KEY)
  storage.remove(IDENTITY_KEY)
  storage.remove(MEMBERSHIPS_KEY)
  storage.remove(TENANT_KEY)
}
