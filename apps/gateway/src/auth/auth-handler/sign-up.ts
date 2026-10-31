import type { AuthMountDeps } from './mount'
import { atPublicPath } from './requests'
import { handedOver } from './sign-in'

/**
 * A sign-up, handed to Better Auth at the path it serves it under, its body as sent: it signs the
 * device in, whose sockets are closed once Better Auth accepted it (`handedOver`).
 */
export function signUp(deps: AuthMountDeps, request: Request): Promise<Response> {
  return handedOver(deps, atPublicPath(request))
}
