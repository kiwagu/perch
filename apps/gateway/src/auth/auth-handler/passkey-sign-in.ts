import { PASSKEY_ERROR_CODES } from '@better-auth/passkey'

import { idSchemas } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { readBody } from '../../read-body'
import { USER_NOT_VERIFIED } from '../passkey-plugin'
import { DEVICE_HEADER, DEVICE_LABEL_HEADER, deviceLabel } from '../session-hooks'
import { watchingSessionWrites } from '../session-writes'

import { acceptedSession, admitted } from './admitted'
import { challengeValue, internalRequest } from './challenge-cookie'
import type { AuthMountDeps } from './mount'
import { ceremonyOf } from './passkey-ceremony'
import { BANNED_USER, badRequest, internal, refusalCodeOf, refused } from './requests'

/** A guest's options of a passkey sign-in: the first half of its ceremony. */
export const PASSKEY_OPTIONS_PATH = '/auth/passkey-options'

/** A sign-in by passkey: the second half of its ceremony. */
export const PASSKEY_SIGN_IN_PATH = '/auth/sign-in/passkey'

/**
 * What a passkey sign-in names: the authenticator's assertion, which Better Auth's plugin reads as
 * it is and whose `id` names the passkey's credential, the challenge of the options it answers as
 * the device carries it (one cookie value), and `signOutOldestFor`, the account whose limit of
 * devices the person confirmed a sign-in past.
 */
const signInBody = z.object({
  response: z.looseObject({ id: z.string().min(1) }),
  challenge: challengeValue,
  signOutOldestFor: idSchemas.identity.schema.optional(),
})

/** The sign-in as the gateway takes it once its request was read. */
type Step = z.infer<typeof signInBody> & {
  readonly device: { readonly id: string; readonly label: string }
}

/**
 * What the plugin answers a verified passkey with, as far as the gateway reads it: the session it
 * wrote, by its raw token, and the account, by the allowlist of an accepted sign-in.
 */
const verifiedPasskey = z
  .object({ session: z.object({ token: z.string().min(1) }), user: acceptedSession.shape.user })
  .transform(({ session, user }) => ({ token: session.token, user }))

/** 401 `passkey-unknown`: no account here holds the passkey, a removed one included. */
const unknownPasskey = (): Response => refused(401, 'passkey-unknown')

/** 400 `failed`: the plugin refused the assertion, and nothing was signed in. */
const failed = (): Response => refused(400, 'failed')

/**
 * Better Auth's refusals of an assertion, by their code: a passkey no account holds; the admin
 * plugin's refusal of a banned account's session; an authenticator that did not verify its user, a
 * signature that does not verify, and a challenge spent, ended, of a registration or past its five
 * minutes. Any other refusal is a failure of the gateway's, a sign-in the directory did not take
 * among them (Better Auth's `STORAGE_FAILED`, `storageFailuresTold`), and so is any refusal that
 * came once the plugin wrote the session (`verified`).
 */
const REFUSALS: ReadonlyMap<string, () => Response> = new Map([
  [PASSKEY_ERROR_CODES.PASSKEY_NOT_FOUND.code, unknownPasskey],
  [BANNED_USER, () => refused(403, 'account-banned')],
  [USER_NOT_VERIFIED, failed],
  [PASSKEY_ERROR_CODES.AUTHENTICATION_FAILED.code, failed],
  [PASSKEY_ERROR_CODES.CHALLENGE_NOT_FOUND.code, failed],
])

/** The device a request names, with its label as a session keeps it; none for an invalid one. */
function deviceOf(request: Request): Step['device'] | undefined {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))

  if (!device.success) {
    return undefined
  }

  const label = deviceLabel.safeParse(request.headers.get(DEVICE_LABEL_HEADER) ?? '')

  return { id: device.data, label: label.success ? label.data : '' }
}

/**
 * A guest's options of a passkey sign-in, with the device's headers: 200 `{ options, challenge }`,
 * the plugin's options (they name no credential, so the browser offers the passkeys of this site
 * it holds, each a discoverable one) with the user's verification required, where the plugin only
 * prefers it, and their challenge, the value of the plugin's cookie, which the gateway never sets
 * on its answer. 400 `bad-request` for a request that names no valid device, before the plugin is
 * asked; 500 `internal` when the plugin answers otherwise. Before the plugin writes the new
 * ceremony, some of those left unfinished and expired are reclaimed (`PasskeyRows.reclaim`).
 */
export async function passkeyOptions(deps: AuthMountDeps, request: Request): Promise<Response> {
  const device = deviceOf(request)

  if (device === undefined) {
    return badRequest()
  }

  // Each start of a ceremony reclaims some of those left unfinished, which nothing else does.
  if ((await deps.passkeys.reclaim()).isErr()) {
    return internal()
  }

  const answer = await deps.auth.handler(
    internalRequest({
      publicUrl: deps.publicUrl,
      path: '/passkey/generate-authenticate-options',
      device,
    }),
  )
  const ceremony =
    answer.status === 200
      ? await ceremonyOf(answer, await deps.passkeyChallenges.cookieName())
      : undefined

  return ceremony === undefined
    ? internal()
    : Response.json({
        options: { ...ceremony.options, userVerification: 'required' },
        challenge: ceremony.challenge,
      })
}

/**
 * The sign-in in the passkey's account's turn, so a removal of the passkey, a ban, a deletion, a
 * reset and a change of the account commit wholly before it or after it: the assertion goes to the
 * plugin's verifier with the challenge as the call's only cookie, the session it writes waiting for
 * its admission, and the plugin reads the passkey itself (one removed before the turn: 401
 * `passkey-unknown`); a verifier that wrote the session and then failed verified the passkey, so the
 * gateway ends that session, which nobody was handed, and answers 500 `internal` (the sessions it
 * wrote are noted for the call, `watchingSessionWrites`). A verified passkey is a sign-in's last
 * step: the account's email, in lower case,
 * forgets its failed sign-ins whatever the admission answers. The session is then admitted
 * (`admitted`) with the start of the account that email names, past the limit of devices only
 * when the person confirmed it for this very account (`signOutOldestFor`); a sign-in the limit
 * asks about answers 409 `{ code: 'device-limit', consentFor }`, naming that account.
 */
async function verified(deps: AuthMountDeps, request: Request, step: Step): Promise<Response> {
  const cookie = await deps.passkeyChallenges.cookieName()
  const { answer, written } = await watchingSessionWrites(() =>
    deps.auth.handler(
      internalRequest({
        publicUrl: deps.publicUrl,
        path: '/passkey/verify-authentication',
        device: step.device,
        challenge: { name: cookie, value: step.challenge },
        pending: true,
        body: { response: step.response },
      }),
    ),
  )

  if (answer.status !== 200 && written.length > 0) {
    // The plugin wrote the session, so the passkey was verified, then failed (a read of the account
    // to answer with): a failure of the service, whatever code it gave. The session was handed to
    // nobody and waits for an admission: it is ended, and the answer is 500 either way.
    for (const token of written) {
      // An ending that failed leaves the session waiting, counted by no admission, handed to nobody.
      await deps.sessions.signOut(token).match(
        () => undefined,
        () => undefined,
      )
    }

    return internal()
  }

  if (answer.status !== 200) {
    return REFUSALS.get((await refusalCodeOf(answer)) ?? '')?.() ?? internal()
  }

  const accepted = verifiedPasskey.safeParse(await answer.json().catch(() => undefined))

  if (!accepted.success) {
    return internal()
  }

  const { token, user } = accepted.data
  const email = user.email.toLowerCase()

  deps.limits.forgetFailedSignIns(email)

  const account = await deps.passwords.credentialOf(email)

  if (account.isErr()) {
    // The session was never handed to its device: it is ended, and the answer is 500 either way.
    return (await deps.sessions.signOut(token)).match(internal, internal)
  }

  const response = await admitted(
    deps,
    request,
    accepted.data,
    account.value?.start,
    step.signOutOldestFor === user.id,
  )

  return response.status === 409
    ? Response.json({ code: 'device-limit', consentFor: user.id }, { status: 409 })
    : response
}

/**
 * A sign-in by passkey (`{ response, challenge, signOutOldestFor? }`, with the device's headers),
 * which no password and no code precede, and which the email's failed sign-ins never keep out. A
 * body that is not the schema's, or a request that names no valid device, answers 400
 * `bad-request` before anything is read or the challenge spent. The passkey's account is read by
 * the assertion's credential (`PasskeyRows.ownerOf`): none answers 401 `passkey-unknown` before
 * the plugin is asked; otherwise the sign-in runs in that account's turn (`verified`): 200 signed
 * in as by a sign-in, 409 `device-limit` with `consentFor`, 400 `failed` for an assertion the
 * plugin refused, 401 `passkey-unknown`, 403 `account-banned`, 500 `internal`.
 */
export async function signInWithPasskey(deps: AuthMountDeps, request: Request): Promise<Response> {
  const body = signInBody.safeParse(await readBody(request))
  const device = deviceOf(request)

  if (!body.success || device === undefined) {
    return badRequest()
  }

  const owner = await deps.passkeys.ownerOf(body.data.response.id)

  if (owner.isErr()) {
    return internal()
  }

  const identity = owner.value

  if (identity === undefined) {
    return unknownPasskey()
  }

  return deps.accounts.run(identity, () => verified(deps, request, { ...body.data, device }))
}
