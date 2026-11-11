import { match } from 'ts-pattern'

import { bearerRefused } from '../../auth/bearer-caller'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import { banHandlers } from './ban-handlers'
import { type Handler, operatorCaller } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'
import { readHandlers } from './read-handlers'
import { type Target, targetOf } from './targets'

/**
 * The console's routes over HTTP, for an operator of the platform: the account whose live session
 * the device's token holds (`Authorization: Bearer *** the raw session token) on the device it
 * names in `X-Perch-Device`, with `operator` among the platform roles read with that session for
 * the request itself.
 *
 * - `GET /console/accounts?q&page&size`: 200 `{ accounts, total }`, page `page` (from 1, default 1)
 *   of `size` accounts (10, 25 or 50, default 25) of those whose email or shown name holds `q` in
 *   any case (absent or empty, every account), the newest first, two made at the same instant by
 *   their id, and the number of them all; a page past the last holds none. Each account is
 *   `{ id, name, email, emailVerified, banned, operator, createdAt }`, its name its profile's or,
 *   while it has none, the one it signed up with.
 * - `GET /console/accounts/:id`: 200 `{ account }`, the account `:id` (an identity id) names:
 *   `{ id, name, email, emailVerified, createdAt, hasProfile, lastSeenAt, operator, banned,
 *   banReason, organisations }`, `lastSeenAt` and `banReason` null when it has none, its
 *   organisations `{ key, name, role }` by key; 404 `account-gone` for an id no account has.
 * - `POST /console/accounts/:id/ban` with `{ reason? }` (at most 500 characters once trimmed, else
 *   400 `bad-request`): 204 once the account is banned with that reason and every session of it
 *   ended `banned`, in one transaction, and then its sockets closed with 4004; an account banned
 *   already keeps its ban with the reason given now.
 * - `POST /console/accounts/:id/unban`: 204 once its ban and the reason are lifted; nothing ends.
 * - `POST /console/accounts/:id/sign-out`: 204 once every session of the account ended `revoked`
 *   and then its sockets closed with 4001.
 *
 * Each action runs in the account's turn, the one the auth mount's changes of an account take,
 * and answers 404 `account-gone` for an id no account has, or no longer has once its turn came; a
 * ban and a sign-out of the operator's own account answer 409 `own-account` before anything else
 * is done (`banHandlers`).
 *
 * Every request is judged first by who sends it, before its method, its path's id, its query or its
 * body is read, and nothing is read for one that is refused: a request that names no valid device
 * answers 400 `bad-request`, one whose token holds no live session (a sign-in still waiting for its
 * admission among them) or one of another device 401 `unauthorized` with `WWW-Authenticate:
 * Bearer`, an account without `operator` 403 `not-operator`. Then a method a path does not take
 * answers 405 with the one it does in `Allow`; a query or a body that does not follow its schema
 * 400 `bad-request`; a failure of the gateway 500 `internal`, the failure itself handed to
 * `onFailure`. A request for another path is not answered here (`undefined`), so the server can
 * try its other routes.
 */
export function consoleRoutes(
  options: ConsoleRoutesOptions,
): (request: Request, from: string) => Promise<Response | undefined> {
  const failed = errorAnswer(options.onFailure)
  const reads = readHandlers(options)
  const standing = banHandlers(options)

  /** The methods the target takes, each with its handler, in the order `Allow` lists them. */
  function handlersOf(target: Target): ReadonlyMap<string, Handler> {
    return match(target)
      .with({ kind: 'accounts' }, () => new Map([['GET', reads.list]]))
      .with({ kind: 'account' }, ({ id }) => new Map([['GET', reads.read(id)]]))
      .with({ kind: 'action', action: 'ban' }, ({ id }) => new Map([['POST', standing.ban(id)]]))
      .with(
        { kind: 'action', action: 'unban' },
        ({ id }) => new Map([['POST', standing.unban(id)]]),
      )
      .with(
        { kind: 'action', action: 'sign-out' },
        ({ id }) => new Map([['POST', standing.signOut(id)]]),
      )
      .exhaustive()
  }

  return async (request, from) => {
    const target = targetOf(new URL(request.url).pathname)

    if (!target) {
      return undefined
    }

    const caller = await operatorCaller(options.sessions, request)

    if (caller.kind !== 'caller') {
      return match(caller)
        .with({ kind: 'not-operator' }, () => refusalAnswer('not-operator'))
        .with({ kind: 'unauthorized' }, () => bearerRefused())
        .with({ kind: 'bad-request' }, () => refusalAnswer('bad-request'))
        .with({ kind: 'failed' }, ({ error }) => failed(error))
        .exhaustive()
    }

    const handlers = handlersOf(target)
    const handler = handlers.get(request.method)

    if (!handler) {
      return Response.json(
        { code: 'method-not-allowed' },
        { status: 405, headers: { Allow: [...handlers.keys()].join(', ') } },
      )
    }

    return handler(caller, request, from)
  }
}
