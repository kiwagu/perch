import type { Clock } from '@workspace/replica'

import type { KeyedTurns } from '../../keyed-turns'
import type { RequestLimits } from '../../limits/request-limits'
import { tooMany } from '../../limits/too-many'
import type { ConnectionRegistry } from '../../sync/connections'
import type { AuthInstance } from '../auth-instance'
import type { AuthSessions } from '../auth-sessions'

import { AUTH_PATHS } from './requests'
import { SIGN_IN_PATH, signIn } from './sign-in'
import { signUp } from './sign-up'
import { resend, verify } from './verification'

const SIGN_UP_PATH = '/auth/sign-up/email'
const VERIFY_PATH = '/auth/verify-email'
const RESEND_PATH = '/auth/send-verification-email'

/**
 * What the mount answers with: Better Auth, the gateway's sessions and limits, the sockets, a
 * clock, the accounts' turns.
 */
export interface AuthMountDeps {
  readonly auth: Pick<AuthInstance, 'handler'>
  readonly sessions: Pick<AuthSessions, 'signedIn' | 'identityOf' | 'verificationEmail'>
  readonly limits: Pick<RequestLimits, 'credentials' | 'signInAttempt' | 'verificationMail'>
  readonly connections: Pick<ConnectionRegistry, 'close'>
  /** The gateway's clock. */
  readonly clock: Clock
  /**
   * One account's sign-ups and verifications, one at a time in this process, by its email in
   * lower case.
   */
  readonly accounts: KeyedTurns<string>
}

/**
 * The endpoints of Better Auth the gateway hands over, each by `POST` only; every other path under
 * `/auth/` answers 404 here. Handing everything over would expose each endpoint Better Auth and
 * its plugins add, such as the list of an account's sessions with every session's token, or an
 * ending of a session that leaves its device's sockets open; a later feature allows its endpoint
 * here on purpose. The verification is taken by POST with its token in the body and handed to
 * Better Auth's GET, so a token never sits in a URL the gateway serves.
 */
const SERVED_PATHS: ReadonlySet<string> = new Set([
  SIGN_UP_PATH,
  SIGN_IN_PATH,
  VERIFY_PATH,
  RESEND_PATH,
])

/**
 * Better Auth's sign-up, sign-in, verification and resend behind the gateway's own limits. Of the
 * paths under `/auth/`, only these four are handed to Better Auth's handler, at the path Better
 * Auth serves them under (the front's prefix put back); another method on them answers 405 with
 * `Allow: POST`, and every other path under `/auth/` 404 `not-found`, Better Auth not asked. A
 * path outside `/auth/` is not answered here (`undefined`). The device routes come before this
 * one in the server, so the sign-outs they serve under `/auth/` are theirs.
 *
 * - `POST /auth/sign-up/email` and `POST /auth/sign-in/email` each first take one of their client
 *   address's credential checks (`RequestLimits.credentials`, `from` being the address the server
 *   resolved). A sign-up then takes one of the address's verification mails, whatever its email,
 *   and runs one email at a time (`signUp`): 202 with no body for every sign-up Better Auth
 *   accepts, a new, a taken or a concurrently taken email alike, no sooner than
 *   `SIGN_UP_FLOOR_MS` after the request began; 400 `bad-request` for a body that names no email;
 *   it signs nothing in and closes no socket. A sign-in answers 200 with the raw session token and
 *   the account, as Better Auth answers it without its cookies. It must first find a place among
 *   its email's failed sign-ins and those still under way (`RequestLimits.signInAttempt`, the
 *   email in lower case), held until Better Auth answers: 401 (wrong credentials) keeps it as a
 *   failure, 200 and 403 (the password was right, the email is not verified) clear the email's,
 *   and any other answer, or a handler that threw, gives it back. A sign-in whose body is not
 *   JSON naming an email answers 400 `bad-request`; one that is reaches Better Auth as that JSON,
 *   whatever content type it came with, so the email Better Auth checks is the one counted. A
 *   sign-in Better Auth accepts closes the identity's sync sockets on the device the request
 *   names with 1000 (`connections`) before its answer is returned: the new session ended the
 *   device's earlier one.
 * - `POST /auth/verify-email` `{ token }`, with the device's headers: takes one of the address's
 *   credential checks too, then exchanges the link's token (`verify`): 200 `{ token, user: { id,
 *   email, name, locale } }` the first time, which signs the device in, 200 `{ token: null }` for
 *   an account verified before, 401 `link-invalid` or `link-expired` for a link that verifies
 *   nothing, 400 `bad-request` without a device or a token, 500 `internal` when the gateway failed.
 * - `POST /auth/send-verification-email` `{ email }`: takes one of the address's verification
 *   mails and one of the email's resends (`RequestLimits.verificationMail`), then asks Better Auth
 *   to send the mail again (`resend`): 202 with no body, alike for any email; 400 `bad-request`
 *   for a body that names no email.
 *
 * A limit that refuses answers 429 `rate-limited` with `Retry-After`, Better Auth not asked. Every
 * other refusal Better Auth answers reaches the client as its status and `{ code }` alone, a
 * failure (500 or more) as `internal`: nothing of its message, its cookies or the rest of its body.
 */
export function authHandler(
  deps: AuthMountDeps,
): (request: Request, from: string) => Promise<Response | undefined> {
  return async (request, from) => {
    const { pathname } = new URL(request.url)

    if (!pathname.startsWith(AUTH_PATHS)) {
      return undefined
    }

    if (!SERVED_PATHS.has(pathname)) {
      return Response.json({ code: 'not-found' }, { status: 404 })
    }

    if (request.method !== 'POST') {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      )
    }

    if (pathname === RESEND_PATH) {
      return resend(deps, request, from)
    }

    const address = deps.limits.credentials(from)

    if (!address.allowed) {
      return tooMany(address)
    }

    if (pathname === SIGN_UP_PATH) {
      return signUp(deps, request, from)
    }

    return pathname === VERIFY_PATH ? verify(deps, request) : signIn(deps, request)
  }
}
