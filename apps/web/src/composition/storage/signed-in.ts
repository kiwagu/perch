/**
 * Who is signed in on this browser, and the session token the device presents to the gateway,
 * kept per sign-in. A tab hears another tab's writes late, and a removal removes whatever the
 * browser holds then, so every record a sign-out or a cleanup removes belongs to one sign-in
 * alone, under the id that sign-in minted before its first write: a tab that has not heard of the
 * next sign-in removes the one it ends, never the next. The one record of the browser, the
 * pointer to the current sign-in, is written by sign-ins only and never removed.
 */

import type { AuthUser } from '@workspace/data'
import { type IdentityId, idSchemas } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import type { SignedInDevice } from '../gateway-auth'

import { forgetAccountStart } from './account-start'
import type { KeyValueStorage } from './key-value'
import { forgetMemberships, saveMemberships } from './memberships'
import { forgetRoles } from './roles'
import { CURRENT_KEY, type KeptSession, type SignInId } from './sign-in'

/** A sign-in's record: `perch.session.signed-in.<id>` = `{ identity, email, token }`. */
const SIGNED_IN_KEY_PREFIX = 'perch.session.signed-in.'

/**
 * The email an email confirmation gave the identity during a sign-in, kept under that sign-in's
 * id (`perch.session.email.<id>`) and read over the record's email while it is current: an
 * answer that comes after another tab ended that sign-in writes beside nothing anyone reads, and
 * never stands over a later sign-in's email.
 */
const EMAIL_KEY_PREFIX = 'perch.session.email.'

/** What older builds kept for the session; nothing reads them now, and a sign-in clears them. */
const OLDER_BUILD_KEYS = ['perch.session.identity', 'perch.session.token', 'perch.session.refresh']

/** The key of the record of sign-in `signIn`. */
export function signedInKeyOf(signIn: SignInId): string {
  return `${SIGNED_IN_KEY_PREFIX}${signIn}`
}

const emailKeyOf = (signIn: SignInId): string => `${EMAIL_KEY_PREFIX}${signIn}`

/** Whether `key` is one the tabs follow a sign-in or a sign-out by: the pointer, or a record. */
export function isSessionKey(key: string): boolean {
  return key === CURRENT_KEY || key.startsWith(SIGNED_IN_KEY_PREFIX)
}

const signedInSchema = z.object({
  identity: idSchemas.identity.schema,
  email: z.string(),
  token: z.string(),
})

const confirmedEmailSchema = z.object({ identity: idSchemas.identity.schema, email: z.string() })

/** The sign-in current on this browser: its session, and the account it shows. */
export interface SavedSignIn {
  readonly session: KeptSession
  readonly user: AuthUser
}

/** A device whose sign-in is whole: who it is, its session token and the memberships it read. */
export interface KeptDevice extends SignedInDevice {
  readonly memberships: readonly Membership[]
}

/**
 * Keeps the device sign-in `signIn` made whole: its record, then the memberships, the pointer
 * last, so a tab that follows the pointer finds the rest saved already (the start of an account
 * that has not started was kept under the id before). What the sign-in the pointer named before
 * kept goes once the pointer moved (the same account's: the one-account check refused any
 * other), and so does what older builds kept.
 */
export function saveDevice(storage: KeyValueStorage, signIn: SignInId, device: KeptDevice): void {
  const replaced = savedSession(storage)

  storage.set(
    signedInKeyOf(signIn),
    JSON.stringify({
      identity: device.identity.id,
      email: device.identity.email,
      token: device.token,
    }),
  )
  saveMemberships(storage, { signIn, identity: device.identity.id }, device.memberships)
  storage.set(CURRENT_KEY, signIn)

  if (replaced !== undefined && replaced.signIn !== signIn) {
    forgetSignIn(storage, replaced.signIn)
  }

  for (const key of OLDER_BUILD_KEYS) {
    storage.remove(key)
  }
}

/**
 * Keeps the new email of `identity`, as its email's confirmation answered, for the sign-in the
 * confirmation was asked in (`asked`, the one current then, none when there was none), while it
 * is the identity's and still kept: never in its record, and never for a sign-in made only by
 * the time of the answer.
 */
export function saveIdentityEmail(
  storage: KeyValueStorage,
  identity: IdentityId,
  email: string,
  asked: KeptSession | undefined,
): void {
  if (asked?.identity === identity && sessionKept(storage, asked)) {
    storage.set(emailKeyOf(asked.signIn), JSON.stringify({ identity, email }))
  }
}

/**
 * The sign-in current on this browser: the one the pointer names, while its record is kept and
 * reads whole, with the email a confirmation asked during it gave the identity; otherwise nobody.
 */
export function savedSignIn(storage: KeyValueStorage): SavedSignIn | undefined {
  const signIn = storage.get(CURRENT_KEY)
  const record = signIn === undefined ? undefined : recordOf(storage, signIn)

  if (signIn === undefined || record === undefined) {
    return undefined
  }

  const confirmed = read(storage, emailKeyOf(signIn), confirmedEmailSchema)
  const email = confirmed?.identity === record.identity ? confirmed.email : record.email

  return {
    session: { signIn, identity: record.identity, token: record.token },
    user: { id: record.identity, email },
  }
}

/** The identity signed in on this browser, if any; see `savedSignIn`. */
export function savedIdentity(storage: KeyValueStorage): AuthUser | undefined {
  return savedSignIn(storage)?.user
}

/** The session this browser keeps now, if it keeps one, whoever it is of. */
export function savedSession(storage: KeyValueStorage): KeptSession | undefined {
  return savedSignIn(storage)?.session
}

/** The session token the device presents to the gateway now, if it keeps one, whoever it is of. */
export function savedToken(storage: KeyValueStorage): string | undefined {
  return savedSession(storage)?.token
}

/**
 * The session token the device keeps now for `identity`; none while it keeps none, or another
 * identity's. The calls made for an identity read its token here, with its owner in one step.
 */
export function savedTokenOf(storage: KeyValueStorage, identity: IdentityId): string | undefined {
  const session = savedSession(storage)

  return session?.identity === identity ? session.token : undefined
}

/** Whether the record of `session`'s sign-in is still kept, for its identity and with its token. */
export function sessionKept(storage: KeyValueStorage, session: KeptSession): boolean {
  const record = recordOf(storage, session.signIn)

  return record?.identity === session.identity && record.token === session.token
}

/**
 * Forgets everything sign-in `signIn` kept, as whatever ends it captured it when it began, never
 * the one the pointer names by then: its record and the email a confirmation kept for it, its
 * memberships and the organisation chosen during it, its platform roles and the start of an
 * account it kept to finish. The pointer stays; the other tabs hear the record go. The inventory
 * of the organisation databases stays, as the databases may, and so do the tokens left to sign
 * out.
 */
export function forgetSignIn(storage: KeyValueStorage, signIn: SignInId): void {
  forgetRecord(storage, signIn)
  forgetMemberships(storage, signIn)
  forgetRoles(storage, signIn)
  forgetAccountStart(storage, signIn)
}

/**
 * A pointer whose record is kept but does not read as one names nobody: that record goes, and
 * the email kept beside it. A record removed already, or none named, leaves nothing to do.
 */
export function dropUnreadableSignIn(storage: KeyValueStorage): void {
  const signIn = storage.get(CURRENT_KEY)

  if (
    signIn !== undefined &&
    storage.get(signedInKeyOf(signIn)) !== undefined &&
    recordOf(storage, signIn) === undefined
  ) {
    forgetRecord(storage, signIn)
  }
}

/** Removes the record of sign-in `signIn` and the email a confirmation kept for it. */
function forgetRecord(storage: KeyValueStorage, signIn: SignInId): void {
  storage.remove(signedInKeyOf(signIn))
  storage.remove(emailKeyOf(signIn))
}

/** The record of sign-in `signIn`, while it is kept and reads whole. */
function recordOf(
  storage: KeyValueStorage,
  signIn: SignInId,
): z.output<typeof signedInSchema> | undefined {
  return read(storage, signedInKeyOf(signIn), signedInSchema)
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
