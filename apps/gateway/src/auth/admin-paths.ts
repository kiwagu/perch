import { adminPlugin } from './admin-plugin'

/**
 * The path of every endpoint of Better Auth's admin plugin as the gateway configures it
 * (`adminPlugin`), read from the plugin's own table of endpoints, so one a later version of the
 * plugin adds is among them: the instance switches every one of them off in its HTTP handler
 * (`disabledPaths`), and the mount serves none of them.
 */
export const ADMIN_PATHS: readonly string[] = Object.values(adminPlugin().endpoints).map(
  (endpoint) => endpoint.path,
)
