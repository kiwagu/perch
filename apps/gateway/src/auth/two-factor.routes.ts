import { matchPath } from '../route-path'

import { signedIn } from './auth-handler'
import { TWO_FACTOR_HANDLERS, type TwoFactorRoutesDeps } from './two-factor-handlers'

export type { TwoFactorRoutesDeps }

/** The method and the path each target is served under. */
const ROUTES = {
  read: { method: 'GET', path: '/two-factor' },
  enable: { method: 'POST', path: '/two-factor/enable' },
  confirm: { method: 'POST', path: '/two-factor/confirm' },
  disable: { method: 'POST', path: '/two-factor/disable' },
  renew: { method: 'POST', path: '/two-factor/renew-codes' },
} as const satisfies Record<keyof typeof TWO_FACTOR_HANDLERS, { method: string; path: string }>

type Target = keyof typeof ROUTES

/** The targets, in the order a path is read against them. */
const TARGETS: readonly Target[] = ['read', 'enable', 'confirm', 'disable', 'renew']

/** The paths the second factor's routes answer. */
export const TWO_FACTOR_PATHS: readonly string[] = TARGETS.map((target) => ROUTES[target].path)

function targetOf(pathname: string): Target | undefined {
  return TARGETS.find((target) => matchPath(ROUTES[target].path, pathname) !== undefined)
}

/**
 * The settings of the signed-in account's second factor over HTTP, for the identity whose live
 * session the device's token holds (`Authorization: Bearer <token>`, the raw session token) on the
 * device it names in `X-Perch-Device`. They are the gateway's own, not Better Auth's endpoints:
 * Better Auth's turning off of a factor and its confirmation of a code, made while signed in,
 * replace the caller's session with a new one, which would sign its other devices' bearers out of
 * step. Here the caller's session is never touched. Each change takes one of the client address's
 * credential checks first (429 `rate-limited` once spent) and a body it can read (400
 * `bad-request`), and runs in the account's turn, so no sign-in's code step, change of the
 * password or turning on or off of the factor interleaves with it.
 *
 * - `GET /two-factor`: 200 `{ enabled }`.
 * - `POST /two-factor/enable` `{ password }`: the factor's policy first (403 `failed` when the
 *   account may not turn it on), then the password (`confirmPassword`: 400 `invalid-credentials`,
 *   counted among the email's failed sign-ins, 429 once they are spent), then 409
 *   `two-factor-changed` while the factor is on; otherwise Better Auth makes a new key and ten
 *   backup codes, replacing the key of an earlier enable that was never confirmed, and the answer
 *   is 200 `{ key, uri, backupCodes, enrolment }`: the key as the text an authenticator app is
 *   given (the base32 secret of the URI), its `otpauth://` URI, the ten codes, shown once, and the
 *   enrolment, the id of the account's new two-factor row. The factor stays off until a code of the
 *   key confirms it.
 * - `POST /two-factor/confirm` `{ code, enrolment }`: 400 `invalid-code` for a code of the key's
 *   current step, or the one before or after, that it is not (`code` is of the contract's length
 *   for a code of the second factor, `enrolment` an id of a two-factor row, else 400
 *   `bad-request`); 409 `two-factor-changed`, whatever the code, when the enrolment is not the
 *   account's row any more or the factor is on already. Otherwise 204 once the account's flag and
 *   the row's confirmation committed together.
 * - `POST /two-factor/disable` `{ password }`: 403 `failed` while the policy requires the factor,
 *   then the password as at an enable; 204 once the factor is off, its key and codes gone and its
 *   pending sign-in challenges ended, and 204 alike for an account whose factor was off.
 * - `POST /two-factor/renew-codes` `{ password }`: the password as at an enable, then 409
 *   `two-factor-changed` while the factor is off; otherwise 200 `{ backupCodes }`, ten new codes
 *   shown once, the earlier ones refused from then on.
 *
 * A method a path does not take answers 405 with the one it does in `Allow`; a request that names
 * no valid device 400 `bad-request`, before any token is read; one whose token holds no live
 * session of that device 401 `unauthorized` with `WWW-Authenticate: Bearer`; a failure of the
 * gateway 500 `internal`, nothing of its cause. A request for another path is not answered here
 * (`undefined`).
 */
export function twoFactorRoutes(
  deps: TwoFactorRoutesDeps,
): (request: Request, from: string) => Promise<Response | undefined> {
  return async (request, from) => {
    const target = targetOf(new URL(request.url).pathname)

    if (target === undefined) {
      return undefined
    }

    const { method } = ROUTES[target]

    if (request.method !== method) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: method } },
      )
    }

    return signedIn(deps, request, (caller) =>
      TWO_FACTOR_HANDLERS[target](deps, request, from, caller),
    )
  }
}
