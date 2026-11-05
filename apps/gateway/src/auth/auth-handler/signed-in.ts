import { match } from 'ts-pattern'

import { bearerCaller, bearerRefused } from '../bearer-caller'

import type { AuthMountDeps } from './mount'
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
  deps: Pick<AuthMountDeps, 'sessions'>,
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
