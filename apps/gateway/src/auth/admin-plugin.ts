import { admin, createAccessControl } from 'better-auth/plugins'
import { defaultStatements } from 'better-auth/plugins/admin/access'

/** The plugin's permissions, over the statements of its own endpoints. */
const control = createAccessControl(defaultStatements)

/**
 * Better Auth's admin plugin as the gateway runs it, a hybrid. The plugin keeps an account's role
 * and ban in its own fields, stored in the directory's columns (`role`, `banned`, `ban_reason`,
 * `ban_expires` of `identity`, `impersonated_by` of `device_session`); it writes the role `user`
 * when Better Auth creates an account; its hook refuses a new session to a banned account (403
 * `BANNED_USER`), after the password and the email's verification were checked and before the
 * gateway's own session hook runs, Better Auth running a plugin's hooks first; and Better Auth's
 * read of a session carries the account's role. None of its endpoints is reachable: every path of
 * them is switched off in the instance's HTTP handler (`ADMIN_PATHS`), the mount serves none, and
 * the gateway never calls them on the server. `operator` is the role the plugin counts as an
 * admin, and `user` its default, which is no platform role (`rolesOf`). Neither is granted any of
 * the plugin's permissions: they would guard only its endpoints, and the gateway judges what an
 * operator may do itself.
 */
export function adminPlugin() {
  return admin({
    roles: {
      user: control.newRole({ user: [], session: [] }),
      operator: control.newRole({ user: [], session: [] }),
    },
    adminRoles: ['operator'],
    defaultRole: 'user',
    schema: {
      user: { fields: { banReason: 'ban_reason', banExpires: 'ban_expires' } },
      session: { fields: { impersonatedBy: 'impersonated_by' } },
    },
  })
}
