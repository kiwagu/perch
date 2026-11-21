/**
 * The set-ups of the passkey specs: an authenticator for the mount's front, the passkey routes over
 * the very sessions, turns and Better Auth the mount answers with, the ceremonies as the web runs
 * them (a registration while signed in, a guest's sign-in), and an account's passkeys and pending
 * registrations read straight from the directory.
 */

import { expect } from 'vitest'

import { fromDriverValue } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { z } from '@workspace/zod'

import {
  type AuthenticationResponse,
  SoftwareAuthenticator,
  type Unlocked,
} from '../../../__fixtures__/software-authenticator'
import { linkToken } from '../../../mail/__fixtures__/outbox'
import passkeyRegistrationsStatement from '../../__fixtures__/passkey-registrations.surql'
import verificationAgeStatement from '../../__fixtures__/verification-age.surql'
import verificationRowsStatement from '../../__fixtures__/verification-rows.surql'
import { passkeyRoutes } from '../../passkey.routes'
import { PasskeyRows } from '../../passkey-rows'
import { passkeyChallenges } from '../passkey-ceremony'
import { RESET_REQUEST_FLOOR_MS } from '../password-reset'

import { answered } from './code-step'
import {
  ANN,
  type mountedOnRealAuth,
  ORIGIN,
  PASSWORD,
  pastFloor,
  postTo,
  type Sender,
} from './mount'

type Mounted = Awaited<ReturnType<typeof mountedOnRealAuth>>

/** The path of a guest's passkey options. */
export const PASSKEY_OPTIONS_PATH = '/auth/passkey-options'

/** The path of a passkey sign-in. */
export const PASSKEY_SIGN_IN_PATH = '/auth/sign-in/passkey'

/** The client address a guest's requests come from. */
const FROM = '198.18.9.2'

/** Better Auth's adapter writes a passkey with an insert into its table. */
export const isPasskeyInsert = (text: string): boolean =>
  text.startsWith('INSERT') && text.includes('`passkey`')

/** Better Auth's adapter moves a passkey's count of signatures on with an update of its table. */
export const isPasskeyUpdate = (text: string): boolean =>
  text.startsWith('UPDATE') && text.includes('passkey')

/** An authenticator for the mount's front: its passkey is bound to the front's host and origin. */
export const authenticator = (): SoftwareAuthenticator =>
  new SoftwareAuthenticator({ rpId: new URL(ORIGIN).hostname, origin: ORIGIN })

/** A ceremony's start as the gateway answers it: the options and the challenge. */
const ceremony = z.object({
  options: z.record(z.string(), z.unknown()),
  challenge: z.string().min(1),
})

export type Ceremony = z.infer<typeof ceremony>

/** The passkeys of an account as the list answers them. */
const listed = z.array(z.object({ id: z.string().min(1), createdAt: z.string().min(1) }))

/** An account's passkeys and pending registrations, as the directory keeps them. */
const registrations = z.object({
  passkeys: z.array(z.string()),
  registrations: z.array(z.string()),
})

/** A row of `verification` as a spec reads it: its identifier and its value. */
const verificationRows = z.array(z.object({ identifier: z.string(), value: z.string() }))

/** What a row of `verification` holds, as the passkey specs tell them apart. */
export type VerificationKind = 'registration' | 'authentication' | 'other'

/** The kind of a row of `verification`, read from its value as Better Auth's plugins write it. */
const kindOf = (value: string): VerificationKind =>
  value.startsWith('{"type":"registration",')
    ? 'registration'
    : value.startsWith('{"type":"authentication",')
      ? 'authentication'
      : 'other'

/** Every row of `verification`, the earliest first: its identifier and its kind. */
export async function verificationsOf(mounted: Mounted) {
  const [rows] = await mounted.local.db.query<[unknown]>(verificationRowsStatement)

  return verificationRows
    .parse(fromDriverValue(rows))
    .map(({ identifier, value }) => ({ identifier, kind: kindOf(value) }))
}

/** Moves the expiry of the rows of `verification` named by `identifiers` to `agoMs` ago. */
export async function ageVerifications(
  mounted: Mounted,
  identifiers: readonly string[],
  agoMs: number,
): Promise<void> {
  await mounted.local.db.query(verificationAgeStatement, {
    identifiers,
    at: new Date(Date.now() - agoMs),
  })
}

/** The passkeys of `identity`, by id, and its pending registrations, by identifier. */
export async function registrationsOf(mounted: Mounted, identity: IdentityId) {
  const [rows] = await mounted.local.db.query<[unknown]>(passkeyRegistrationsStatement, {
    identity,
  })

  return registrations.parse(fromDriverValue(rows))
}

/** A request of `sender` (with its device and token) to `path` of the passkey routes. */
function request(method: string, path: string, sender: Sender, body?: unknown): Request {
  const headers = new Headers({ 'X-Perch-Device': sender.device, origin: ORIGIN })

  if (sender.token !== undefined) {
    headers.set('authorization', `Bearer ${sender.token}`)
  }

  if (body !== undefined) {
    headers.set('content-type', 'application/json')
  }

  return new Request(`http://gateway.test${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

/**
 * The passkey routes over the mount's own Better Auth, sessions and turns, so a registration or a
 * removal waits for the turn of a change of the account or of a passkey sign-in, and helpers that
 * ask them as a signed-in device does.
 */
export function passkeysOf(mounted: Mounted) {
  const route = passkeyRoutes({
    auth: mounted.deps.auth,
    sessions: mounted.sessions,
    accounts: mounted.turns,
    rows: new PasskeyRows(mounted.directory),
    challenges: passkeyChallenges(mounted.auth),
    publicUrl: ORIGIN,
  })
  const ask = async (method: string, path: string, sender: Sender, body?: unknown) =>
    answered(await route(request(method, path, sender, body), '198.18.9.1'))
  const options = (sender: Sender) => ask('POST', '/passkeys/options', sender)
  const add = (sender: Sender, body: unknown) => ask('POST', '/passkeys', sender, body)

  /** The registration's options for `sender`, which the test fails unless they are answered. */
  const started = async (sender: Sender): Promise<Ceremony> => {
    const { status, body } = await options(sender)

    expect(status).toBe(200)

    return ceremony.parse(body)
  }

  return {
    route,
    request,
    list: (sender: Sender) => ask('GET', '/passkeys', sender),
    options,
    add,
    remove: (sender: Sender, id: string) => ask('DELETE', `/passkeys/${id}`, sender),
    started,
    /** The body of an add: `held`'s answer to options `sender` was given, and their challenge. */
    made: async (sender: Sender, held: SoftwareAuthenticator, unlocked?: Unlocked) => {
      const { options: asked, challenge } = await started(sender)

      return { response: held.create(asked, unlocked), challenge }
    },
    /** Adds `held`'s passkey to `sender`'s account, and answers its id. */
    registered: async (sender: Sender, held: SoftwareAuthenticator): Promise<string> => {
      const { options: asked, challenge } = await started(sender)

      expect((await add(sender, { response: held.create(asked), challenge })).status).toBe(201)

      const { body } = await ask('GET', '/passkeys', sender)
      const ids = listed.parse(body).map(({ id }) => id)

      return ids.at(-1) ?? expect.unreachable('the passkey added')
    },
    /** The passkeys of `sender`'s account, as the list answers them. */
    listed: async (sender: Sender) => listed.parse((await ask('GET', '/passkeys', sender)).body),
  }
}

/** A guest's options of a passkey sign-in from `device`, as the web asks for them. */
export const guestOptionsRequest = (device: string | null): Request =>
  postTo(PASSKEY_OPTIONS_PATH, {}, device === null ? undefined : { device })

/** The options a guest on `device` is given; the test fails unless they are answered. */
export async function guestCeremony(mounted: Mounted, device: string): Promise<Ceremony> {
  const { status, body } = await answered(await mounted.route(guestOptionsRequest(device), FROM))

  expect(status).toBe(200)

  return ceremony.parse(body)
}

/** What a passkey sign-in sends: the authenticator's assertion and the options' challenge. */
export interface Assertion {
  readonly response: AuthenticationResponse
  readonly challenge: string
}

/** `held`'s assertion for a sign-in from `device`, of options the guest was given there. */
export async function assertionOf(
  mounted: Mounted,
  device: string,
  held: SoftwareAuthenticator,
  unlocked?: Unlocked,
): Promise<Assertion> {
  const { options, challenge } = await guestCeremony(mounted, device)

  return { response: held.get(options, unlocked), challenge }
}

/**
 * The passkey sign-in of `assertion` from `device` (none names no device), as the web sends it;
 * `signOutOldestFor` confirms a sign-in past the limit of devices of the account it names.
 */
export function passkeySignInRequest(
  assertion: Assertion,
  device: string | null,
  signOutOldestFor?: string,
): Request {
  return postTo(
    PASSKEY_SIGN_IN_PATH,
    signOutOldestFor === undefined ? assertion : { ...assertion, signOutOldestFor },
    device === null ? undefined : { device },
  )
}

/** A whole passkey sign-in from `device` with `held`: the options, the assertion, the answer. */
export async function passkeySignIn(
  mounted: Mounted,
  device: string,
  held: SoftwareAuthenticator,
  options: Unlocked & { readonly signOutOldestFor?: string } = {},
) {
  const assertion = await assertionOf(mounted, device, held, options)

  return answered(
    await mounted.route(passkeySignInRequest(assertion, device, options.signOutOldestFor), FROM),
  )
}

/** The token of the reset link mailed to `email` once a reset was asked for it from `from`. */
export async function resetLinkOf(mounted: Mounted, from: string, email = ANN): Promise<string> {
  const seen = mounted.outbox.to(email).length
  const asked = await pastFloor(
    mounted.clock,
    mounted.route(postTo('/auth/request-password-reset', { email }), from),
    RESET_REQUEST_FLOOR_MS,
  )

  expect(asked?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}

/**
 * The token of the deletion link mailed to `email` once `sender` asked to delete its account from
 * `from`, confirmed by its password.
 */
export async function deletionLinkOf(
  mounted: Mounted,
  sender: Sender,
  from: string,
  email = ANN,
): Promise<string> {
  const seen = mounted.outbox.to(email).length
  const asked = await mounted.route(
    postTo('/auth/request-account-deletion', { password: PASSWORD }, sender),
    from,
  )

  expect(asked?.status).toBe(202)

  return linkToken(await mounted.outbox.next(email, seen))
}
