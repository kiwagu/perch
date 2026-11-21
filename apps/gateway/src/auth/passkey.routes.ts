import { matchPath } from '../route-path'

import { signedIn } from './auth-handler'
import { PASSKEY_HANDLERS, type PasskeyHandler, type PasskeyRoutesDeps } from './passkey-handlers'

export type { PasskeyRoutesDeps }

/** The path each target is served under, a passkey's id written `:id`. */
const PATH_OF = {
  options: '/passkeys/options',
  passkey: '/passkeys/:id',
  passkeys: '/passkeys',
} as const

type Target = keyof typeof PATH_OF

/**
 * The targets in the order a path is read against them: the registration's options before a
 * passkey's path, whose segment it would otherwise be.
 */
const TARGETS: readonly Target[] = ['options', 'passkey', 'passkeys']

/** The handler of each method a target takes, in the order `Allow` names them. */
const METHODS = {
  options: { POST: PASSKEY_HANDLERS.options },
  passkey: { DELETE: PASSKEY_HANDLERS.remove },
  passkeys: { GET: PASSKEY_HANDLERS.list, POST: PASSKEY_HANDLERS.add },
} as const satisfies Record<Target, Readonly<Record<string, PasskeyHandler>>>

/** The paths the passkey routes answer. */
export const PASSKEY_PATHS: readonly string[] = Object.values(PATH_OF)

/** The target `pathname` names, and the passkey's id it carries (empty for the others). */
function targetOf(pathname: string): { readonly target: Target; readonly id: string } | undefined {
  for (const target of TARGETS) {
    const params = matchPath(PATH_OF[target], pathname)

    if (params !== undefined) {
      return { target, id: 'id' in params ? params.id : '' }
    }
  }

  return undefined
}

/**
 * The passkeys of the signed-in account over HTTP, for the identity whose live session the device's
 * token holds (`Authorization: Bearer <token>`, the raw session token) on the device it names in
 * `X-Perch-Device`. A registration and a removal run in the account's turn, so a deletion of the
 * account, a ban, a reset or a change of its password, and a passkey sign-in, commit wholly before
 * or after each of them; the turn reads the caller's session again first (401 when it ended while
 * the request waited). Better Auth's passkey plugin makes a registration's options and checks the
 * authenticator's answer, reached by the gateway's own calls with the caller's token; its
 * challenge cookie goes to the device as `challenge` and comes back as the only cookie of the next
 * call, never as a cookie of the gateway's answer.
 *
 * - `GET /passkeys`: 200 `[{ id, createdAt }]`, the account's passkeys, the earliest added first.
 * - `POST /passkeys/options`: 200 `{ options, challenge }`, the options of a registration for the
 *   browser's authenticator (a discoverable credential, its user verified) and their challenge;
 *   401 `unauthorized` when the session ended before the plugin read it.
 * - `POST /passkeys` `{ response, challenge }`: 201 once the authenticator's answer to those
 *   options is the account's passkey; 400 `failed` for an answer the plugin refused (an
 *   authenticator that did not verify its user, a challenge spent, of another account or past its
 *   five minutes, an answer that does not verify), nothing kept; 400 `bad-request` for a body that
 *   names no answer or no challenge of one cookie value; 401 `unauthorized` as for the options. A
 *   sign-out or a revocation, which take no turn, that ends the session once the plugin read it
 *   lets the passkey be added, as one added just before it would be.
 * - `DELETE /passkeys/:id`: 204 once passkey `:id` of the account is removed (it signs nothing in
 *   from then on; the devices it signed in stay signed in); 404 `failed` for an id that names no
 *   passkey of the account, another account's included; 400 `bad-request` for a text that is not
 *   a passkey's id, before any passkey is looked for.
 *
 * A method a path does not take answers 405 with those it does in `Allow`; a request that names no
 * valid device 400 `bad-request`, before any token is read; one whose token holds no live session
 * of that device 401 `unauthorized` with `WWW-Authenticate: Bearer`; a failure of the gateway 500
 * `internal`, nothing of its cause. A request for another path is not answered here (`undefined`).
 */
export function passkeyRoutes(
  deps: PasskeyRoutesDeps,
): (request: Request, from: string) => Promise<Response | undefined> {
  return async (request) => {
    const found = targetOf(new URL(request.url).pathname)

    if (found === undefined) {
      return undefined
    }

    const methods: Readonly<Record<string, PasskeyHandler>> = METHODS[found.target]
    const handler = methods[request.method]

    if (handler === undefined) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: Object.keys(methods).join(', ') } },
      )
    }

    return signedIn(deps, request, (caller) => handler(deps, request, caller, found.id))
  }
}
