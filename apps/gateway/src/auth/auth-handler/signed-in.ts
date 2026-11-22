import { match } from 'ts-pattern'

import type { AuthSessions } from '../auth-sessions'
import { bearerCaller, bearerRefused } from '../bearer-caller'

import { badRequest, internal } from './requests'

/** Who a call of the mount with a session token comes from, once its session was read. */
export type MountCaller = Extract<
  Awaited<ReturnType<typeof bearerCaller>>,
  { readonly kind: 'caller' }
>

/**
 * Answers `request` with `handler` once its token and device name a live session of the device,
 * as the device routes do: 400 `bad-request` for a request that names no valid device, before
 * any token is read; 401 `unauthorized` with `WWW-Authenticate: Bearer` for a token that holds
 * no live session of it; 500 `internal` for a session that could not be read.
 */
export async function signedIn(
  deps: { readonly sessions: Pick<AuthSessions, 'read'> },
  request: Request,
  handler: (caller: MountCaller) => Promise<Response>,
): Promise<Response> {
  const caller = await bearerCaller(deps.sessions, request)

  return match(caller)
    .with({ kind: 'caller' }, (found) => handler(found))
    .with({ kind: 'unauthorized' }, async () => bearerRefused())
    .with({ kind: 'bad-request' }, async () => badRequest())
    .with({ kind: 'failed' }, async () => internal())
    .exhaustive()
}

/**
 * The caller's session read again, in the account's turn, once the work waited for it: its
 * account's email as it is now, in lower case, or the answer that refuses the work. 401
 * `unauthorized` when the session ended meanwhile or is no longer this device's, 500 `internal`
 * when it could not be read.
 */
export async function stillSignedIn(
  deps: { readonly sessions: Pick<AuthSessions, 'read'> },
  caller: MountCaller,
): Promise<Response | { readonly email: string }> {
  const read = await deps.sessions.read(caller.token)

  if (read.kind === 'failed') {
    return internal()
  }

  if (
    read.kind === 'none' ||
    read.caller.identity !== caller.identity ||
    read.caller.device !== caller.device
  ) {
    return bearerRefused()
  }

  return { email: read.caller.email.toLowerCase() }
}
