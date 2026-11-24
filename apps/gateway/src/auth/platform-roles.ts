import { PLATFORM_ROLES, type PlatformRole } from '@workspace/kernel'

/**
 * The platform roles of an account whose directory row holds `role`, the one role string Better
 * Auth's admin plugin keeps: `operator` is the platform role of that name; the plugin's default
 * `user`, a row without a role and any other value hold none.
 */
export function rolesOf(role: string | null | undefined): readonly PlatformRole[] {
  return PLATFORM_ROLES.filter((platformRole) => platformRole === role)
}
