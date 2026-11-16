import { match } from 'ts-pattern'

import { bearerRefused } from '../../auth/bearer-caller'
import { errorAnswer, refusalAnswer } from '../console-refusal'

import { banHandlers } from './ban-handlers'
import { editHandlers } from './edit-handlers'
import { mailHandlers } from './mail-handlers'
import { type Handler, operatorCaller } from './operator-caller'
import type { ConsoleRoutesOptions } from './options'
import { readHandlers } from './read-handlers'
import { removalHandler } from './removal-handler'
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
 * - `POST /console/accounts/:id/rename` with `{ name }`: 204 once the account's profile carries the
 *   name, trimmed, written through its private region; 400 `name-required` or `name-too-long` (1
 *   to 80 characters), 409 `failed` for an account that has no profile yet (`editHandlers`).
 * - `POST /console/accounts/:id/email` with `{ email }`: 204 once the mail with the link of the
 *   change is on its way to the new email, the account's earlier pending change ended; 400
 *   `email-invalid`, 409 `email-taken` for an email an account holds, the account's own included,
 *   429 `rate-limited` past the account's three changes in a quarter of an hour (`editHandlers`).
 * - `POST /console/accounts/:id/ban` with `{ reason? }` (at most 500 characters once trimmed, else
 *   400 `bad-request`): 204 once the account is banned with that reason and every session of it
 *   ended `banned`, in one transaction, and then its sockets closed with 4004; an account banned
 *   already keeps its ban with the reason given now.
 * - `POST /console/accounts/:id/unban`: 204 once its ban and the reason are lifted; nothing ends.
 * - `POST /console/accounts/:id/sign-out`: 204 once every session of the account ended `revoked`
 *   and then its sockets closed with 4001.
 * - `POST /console/accounts/:id/reset`: 204 once the reset mail is on its way to the account's
 *   email; 429 `rate-limited` past that email's three in a quarter of an hour (`mailHandlers`).
 * - `POST /console/accounts/:id/verification`: 204 once the verification mail is on its way to the
 *   account's email; 409 `verified-before` for an email verified already, 429 `rate-limited` past
 *   that email's three in a quarter of an hour (`mailHandlers`).
 * - `POST /console/accounts/:id/removal`: 204 once the account is gone as its own deletion leaves
 *   it, its sockets closed with 4001 before and after its rows went, the notice on its way to the
 *   email it had; 409 `last-admin` for the only admin of an organisation with other members,
 *   nothing changed (`removalHandler`).
 *
 * Each action runs in the account's turn, the one the auth mount's changes of an account take,
 * and answers 404 `account-gone` for an id no account has, or no longer has once its turn came; a
 * ban, a sign-out and a removal of the operator's own account answer 409 `own-account` before
 * anything else is done. A mail counts against the operator's address and the account's own
 * allowances, as the account's own request does; a refused one answers 429 `rate-limited` with
 * `Retry-After`.
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
  const edits = editHandlers(options)
  const standing = banHandlers(options)
  const mails = mailHandlers(options)
  const removal = removalHandler(options)

  /** The methods the target takes, each with its handler, in the order `Allow` lists them. */
  function handlersOf(target: Target): ReadonlyMap<string, Handler> {
    return match(target)
      .with({ kind: 'accounts' }, () => new Map([['GET', reads.list]]))
      .with({ kind: 'account' }, ({ id }) => new Map([['GET', reads.read(id)]]))
      .with({ kind: 'action', action: 'rename' }, ({ id }) => new Map([['POST', edits.rename(id)]]))
      .with(
        { kind: 'action', action: 'email' },
        ({ id }) => new Map([['POST', edits.changeEmail(id)]]),
      )
      .with({ kind: 'action', action: 'ban' }, ({ id }) => new Map([['POST', standing.ban(id)]]))
      .with(
        { kind: 'action', action: 'unban' },
        ({ id }) => new Map([['POST', standing.unban(id)]]),
      )
      .with(
        { kind: 'action', action: 'sign-out' },
        ({ id }) => new Map([['POST', standing.signOut(id)]]),
      )
      .with(
        { kind: 'action', action: 'reset' },
        ({ id }) => new Map([['POST', mails.sendReset(id)]]),
      )
      .with(
        { kind: 'action', action: 'verification' },
        ({ id }) => new Map([['POST', mails.resendVerification(id)]]),
      )
      .with({ kind: 'action', action: 'removal' }, ({ id }) => new Map([['POST', removal(id)]]))
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
