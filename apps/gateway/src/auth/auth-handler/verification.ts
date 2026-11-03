import type { IdentityId } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { SUPERSEDED } from '../../sync/sync-connection'
import { type SignInCredential, signInStands } from '../account-passwords'
import type { MailedVerification } from '../auth-sessions'
import { DEVICE_HEADER } from '../session-hooks'

import type { AuthMountDeps } from './mount'
import {
  badRequest,
  internal,
  publicUrl,
  refusalOf,
  refused,
  withJsonBody,
  withoutCredentials,
} from './requests'

const verifyBody = z.object({ token: z.string().min(1).max(4096) })
const resendBody = z.object({ email: z.string().min(1).max(320) })
const linkRefusal = z.object({ code: z.string() })

/**
 * Holds the session a first verification signed in to the account its link was mailed to, as a
 * sign-in is held (`signInStands`): the email's account and the hash of its password, read before
 * Better Auth was asked (`before`), are read again now that it wrote the session, and the session
 * stands only when both reads found that very account, with the same password, and Better Auth
 * signed that account in. A verification holds the email's turn, not the account's, so a reset of
 * the account runs beside it: one that commits while Better Auth verifies the email, before the
 * session is written, ends every session it finds, the new one not yet among them. So when the
 * password changed, or the email left the account, the session is ended at once by its token, and
 * the answer carries none: `{ token: null }` while the email is still the account's (it is
 * verified: the reset verified it, if Better Auth had not), 401 `link-invalid` once it is not. A
 * session that no longer reads (a reset ended it after it was written) has nothing left to end.
 * A readback or a second read that fails answers 500 `internal`, a session that was read back
 * ended first.
 */
async function standing(
  deps: AuthMountDeps,
  signed: string,
  email: string,
  identity: IdentityId,
  before: SignInCredential | undefined,
): Promise<Response> {
  const account = await deps.sessions.signedIn(signed)
  const after = await deps.passwords.credentialOf(email)
  const session = account.isOk() ? account.value : undefined

  if (
    session !== undefined &&
    after.isOk() &&
    session.user.id === identity &&
    signInStands(before, after.value, identity)
  ) {
    return Response.json({ token: session.token, user: session.user })
  }

  const ended = session === undefined || (await deps.sessions.signOut(session.token)).isOk()

  if (account.isErr() || after.isErr() || !ended) {
    return internal()
  }

  return after.value?.identity === identity
    ? Response.json({ token: null })
    : refused(401, 'link-invalid')
}

/**
 * Asks Better Auth for the exchange, holding the account's turn by the email: the account that
 * holds the email, and the hash of its password, are read first (nothing is verified yet if that
 * read fails), and the link verifies only the account its mail went to. When another account
 * holds the email, or none does (the email moved away, and maybe a new account signed up with it),
 * the link is dead (401 `link-invalid`) and Better Auth is not asked: its token names the email
 * alone, and would verify, and sign in, whichever account holds it now. Otherwise Better Auth
 * verifies with its token alone (no `callbackURL`: it never redirects) and without the request's
 * credentials. A first verification signs the device in: the identity's sockets on the device are
 * closed with 1000 at once, as at a sign-in, before the session is read back and held to the
 * account (`standing`), so a readback that fails, or a session that cannot stand, still leaves no
 * socket of the ended session open.
 */
async function exchange(
  deps: AuthMountDeps,
  request: Request,
  verification: MailedVerification,
  email: string,
  device: string,
): Promise<Response> {
  const holder = await deps.passwords.credentialOf(email)

  if (holder.isErr()) {
    return internal()
  }

  if (holder.value?.identity !== verification.identity) {
    return refused(401, 'link-invalid')
  }

  const url = new URL(publicUrl(request))

  url.search = new URLSearchParams({ token: verification.token }).toString()

  const answer = await deps.auth.handler(
    new Request(url.href, {
      method: 'GET',
      headers: withoutCredentials(request.headers),
      signal: request.signal,
    }),
  )

  if (answer.status === 401) {
    const refusal = linkRefusal.safeParse(await answer.json().catch(() => undefined))

    return refused(
      401,
      refusal.success && refusal.data.code === 'TOKEN_EXPIRED' ? 'link-expired' : 'link-invalid',
    )
  }

  if (answer.status !== 200) {
    return refusalOf(answer)
  }

  const signed = answer.headers.get('set-auth-token')

  if (signed === null) {
    return Response.json({ token: null })
  }

  await deps.connections.close(verification.identity, device, SUPERSEDED)

  return standing(deps, signed, email, verification.identity, holder.value)
}

/**
 * Exchanges a verification link's token. The device is named first: Better Auth marks the email
 * verified before it creates the session, so a session refused for want of a device would leave
 * the email verified and nobody signed in. The link's token is read with a key derived from the
 * gateway's secret (`AuthSessions.verificationOf`): one the gateway did not sign as a link's is
 * dead (401 `link-invalid`), and one whose Better Auth token no longer reads has outlived its day
 * (401 `link-expired`; the gateway signed it when that token was fresh), Better Auth not asked.
 * Otherwise one account's verifications run one at a time in this process (`deps.accounts`, by the
 * email Better Auth's token names): Better Auth rereads the account's `emailVerified` inside the
 * turn, so of two exchanges at once, on one link or two, the second answers `{ token: null }` and
 * signs nothing in, and no sign-up or confirmation gives the email to another account meanwhile.
 */
export async function verify(deps: AuthMountDeps, request: Request): Promise<Response> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))
  const body = verifyBody.safeParse(await readBody(request))

  if (!device.success || !body.success) {
    return badRequest()
  }

  const verification = await deps.sessions.verificationOf(body.data.token)

  if (verification === undefined) {
    return refused(401, 'link-invalid')
  }

  const { email } = verification

  return email === undefined
    ? refused(401, 'link-expired')
    : deps.accounts.run(email, () => exchange(deps, request, verification, email, device.data))
}

/**
 * Asks Better Auth to send the verification mail again, with the email alone and without the
 * request's credentials, so only its path for a visitor runs: the same answer, after the same
 * floor of time, for an unverified, a verified and an unknown email. The address's verification
 * mails and the email's resends are taken first (`verificationMail`). An accepted resend answers
 * `202` with no body.
 */
export async function resend(
  deps: AuthMountDeps,
  request: Request,
  from: string,
): Promise<Response> {
  const body = resendBody.safeParse(await readBody(request))

  if (!body.success) {
    return badRequest()
  }

  const allowed = deps.limits.verificationMail(from, body.data.email.toLowerCase())

  if (!allowed.allowed) {
    return tooMany(allowed)
  }

  const answer = await deps.auth.handler(
    withJsonBody(request, { email: body.data.email }, withoutCredentials(request.headers)),
  )

  return answer.status === 200 ? new Response(null, { status: 202 }) : refusalOf(answer)
}
