import { ok } from 'neverthrow'

import type { IdentityId } from '@workspace/ids'
import { deviceId } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { tooMany } from '../../limits/too-many'
import { readBody } from '../../read-body'
import { SUPERSEDED } from '../../sync/sync-connection'
import { DEVICE_HEADER } from '../session-hooks'

import type { AuthMountDeps } from './mount'
import { publicUrl, refusalOf, withJsonBody, withoutCredentials } from './requests'

const verifyBody = z.object({ token: z.string().min(1).max(4096) })
const resendBody = z.object({ email: z.string().min(1).max(320) })
const linkRefusal = z.object({ code: z.string() })

const badRequest = (): Response => Response.json({ code: 'bad-request' }, { status: 400 })
const internal = (): Response => Response.json({ code: 'internal' }, { status: 500 })

/**
 * Asks Better Auth for the exchange, holding the account's turn: the identity the token's email
 * names is read first (nothing is verified yet if that read fails), then Better Auth verifies with
 * the token alone (no `callbackURL`: it never redirects) and without the request's credentials. A
 * first verification signs the device in: the identity's sockets on the device are closed with
 * 1000 at once, as at a sign-in, before the session is read back for the answer, so a readback that
 * fails still leaves no socket of the ended session open.
 */
async function exchange(
  deps: AuthMountDeps,
  request: Request,
  token: string,
  device: string,
  email: string | undefined,
): Promise<Response> {
  const identity =
    email === undefined
      ? ok<IdentityId | undefined>(undefined)
      : await deps.sessions.identityOf(email)

  if (identity.isErr()) {
    return internal()
  }

  const url = new URL(publicUrl(request))

  url.search = new URLSearchParams({ token }).toString()

  const answer = await deps.auth.handler(
    new Request(url.href, {
      method: 'GET',
      headers: withoutCredentials(request.headers),
      signal: request.signal,
    }),
  )

  if (answer.status === 401) {
    const refused = linkRefusal.safeParse(await answer.json().catch(() => undefined))

    return Response.json(
      {
        code:
          refused.success && refused.data.code === 'TOKEN_EXPIRED'
            ? 'link-expired'
            : 'link-invalid',
      },
      { status: 401 },
    )
  }

  if (answer.status !== 200) {
    return refusalOf(answer)
  }

  const signed = answer.headers.get('set-auth-token')

  if (signed === null) {
    return Response.json({ token: null })
  }

  // Better Auth signs in the account the token's email names, which the read above found under the
  // same turn; a session without it cannot happen.
  if (identity.value === undefined) {
    return internal()
  }

  await deps.connections.close(identity.value, device, SUPERSEDED)

  const account = await deps.sessions.signedIn(signed)

  return account.isOk() && account.value !== undefined
    ? Response.json({ token: account.value.token, user: account.value.user })
    : internal()
}

/**
 * Exchanges a verification link's token. The device is named first: Better Auth marks the email
 * verified before it creates the session, so a session refused for want of a device would leave
 * the email verified and nobody signed in. The token's email is read with the gateway's secret,
 * and one account's verifications run one at a time in this process (`deps.accounts`): Better Auth
 * rereads the account's `emailVerified` inside the turn, so of two exchanges at once, on one link or
 * two, the second answers `{ token: null }` and signs nothing in. A token the secret does not read
 * (forged, or past its lifetime) needs no turn: Better Auth refuses it.
 */
export async function verify(deps: AuthMountDeps, request: Request): Promise<Response> {
  const device = deviceId.safeParse(request.headers.get(DEVICE_HEADER))
  const body = verifyBody.safeParse(await readBody(request))

  if (!device.success || !body.success) {
    return badRequest()
  }

  const { token } = body.data
  const email = await deps.sessions.verificationEmail(token)
  const run = () => exchange(deps, request, token, device.data, email)

  return email === undefined ? run() : deps.accounts.run(email, run)
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
