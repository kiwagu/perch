/**
 * The gateway's composition root: the only module of the gateway that opens the central
 * database and the organisations' databases, and builds the services over them.
 */

import type { ResultAsync } from 'neverthrow'

import {
  type DataError,
  type Engines,
  type LocalDb,
  openLocalDb,
  tenantDatabase,
} from '@workspace/data'
import { readSchema } from '@workspace/data/schema-files'
import { replicaSchema } from '@workspace/database/replica-schema'
import { createLogger } from '@workspace/logger'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import { RegionHub } from '@workspace/replica/server'

import { AccountDeletions, EmailChanges, ResetLinks } from '../auth/account-links'
import { AccountMails } from '../auth/account-mails'
import { AccountPasswords } from '../auth/account-passwords'
import { AccountTeardown } from '../auth/account-teardown'
import type { AccountDepartures } from '../auth/auth-handler'
import { type AuthInstance, createAuthInstance } from '../auth/auth-instance'
import { AuthSessions } from '../auth/auth-sessions'
import { DeviceSessions } from '../auth/device-sessions'
import { ProfileEmails } from '../auth/profile-emails'
import { DIRECTORY, FRONT_PREFIX, NAMESPACE } from '../config'
import { KeyedTurns } from '../keyed-turns'
import { RequestLimits } from '../limits/request-limits'
import type { MailPort } from '../mail'
import { ConnectionRegistry } from '../sync/connections'
import { AccountDeparture } from '../tenants/account-departure'
import { InvitationMails, invitationLink, PendingInvitations } from '../tenants/invitations'
import { Organisations } from '../tenants/organisations'
import { regionDatabases } from '../tenants/region-databases'
import { TenantDatabases } from '../tenants/tenant-databases'

export interface GatewayRoot {
  /**
   * Better Auth over the directory: the server hands it the sign-up, the sign-in, the
   * verification and the resend under `/auth`; the gateway reads sessions through its API.
   */
  readonly auth: AuthInstance
  /** The sessions of devices: read through Better Auth, ended by the gateway's own updates. */
  readonly sessions: AuthSessions
  /** The session rows of each identity's devices: listed, looked up by token, marked seen. */
  readonly deviceSessions: DeviceSessions
  /** The reset, the change and the check of a password, through Better Auth on the server. */
  readonly passwords: AccountPasswords
  /** The reset links Better Auth keeps: read by token, ended for an account. */
  readonly resets: ResetLinks
  /** The pending changes of accounts' emails, their links, and the change itself. */
  readonly emailChanges: EmailChanges
  /** The pending deletions of accounts, and their links. */
  readonly deletions: AccountDeletions
  /**
   * The organisations a deleted account leaves: whether it is the only admin of one with other
   * members, read from the directory's memberships (`AccountDeparture.blocked`), and its departure
   * with the steps of the deletion in the turns of the organisations' memberships
   * (`Organisations.leaveAll`).
   */
  readonly departure: AccountDepartures
  /** Whom the notice of a deleted account goes to, and the removal of the account's own rows. */
  readonly teardown: AccountTeardown
  /** The mails about an account the gateway sends itself: confirmations and notices. */
  readonly mails: AccountMails
  /** The profile's email, which follows the account's into its private region through the hub. */
  readonly profiles: ProfileEmails
  readonly organisations: Organisations
  /** The organisations' databases, each opened on first use. */
  readonly databases: TenantDatabases
  /**
   * The region hub: it keeps private regions in the directory and each tenant region in its
   * organisation's database.
   */
  readonly hub: RegionHub
  /** Which tables replicate, and who may write what in them. */
  readonly schema: ReplicaSchema
  /**
   * The open sync connections of each identity and device: told of every change of its
   * memberships, a removed identity's lose the organisation's region at once, and a device
   * signed out from another one is closed.
   */
  readonly connections: ConnectionRegistry
  /** The directory database. */
  readonly local: LocalDb
  /**
   * The request limits of this process: the failed sign-ins of each email, the invitations and
   * the organisations created.
   */
  readonly limits: RequestLimits
  /**
   * One account's work runs one turn at a time in this process: its sign-ups, verifications and
   * reset requests by its email in lower case, its resets and changes by its identity's key.
   */
  readonly accountTurns: KeyedTurns<string>
  readonly clock: Clock
  /**
   * Drops the hub's regions once their work is done, closes the organisations' databases, then
   * the directory.
   */
  close(): Promise<void>
}

export interface GatewayRootOptions {
  /** Engines from `@workspace/data/engines/remote`, or embedded ones in tests. */
  readonly engines: Engines
  /**
   * The database's WebSocket endpoint: the directory's connection, opened as the gateway's
   * namespace user, which Better Auth's adapter queries through too.
   */
  readonly url: string
  /** The gateway's namespace user; an embedded database needs none. */
  readonly credentials?: { readonly username: string; readonly password: string }
  /** The secret Better Auth signs and encrypts with. */
  readonly authSecret: string
  /**
   * The front's public origin, with no trailing slash: the base of the auth routes' public URL
   * and the one origin Better Auth trusts.
   */
  readonly publicUrl: string
  /** Where the account mails go: the SMTP server of `GATEWAY_SMTP_URL`, or a spec's outbox. */
  readonly mail: MailPort
  readonly clock: Clock
}

export function createGatewayRoot(
  options: GatewayRootOptions,
): ResultAsync<GatewayRoot, DataError> {
  const hubLog = createLogger('region-hub')
  const tenantsLog = createLogger('tenant-databases')
  const connectionsLog = createLogger('connections')
  const authLog = createLogger('auth')
  const organisationsLog = createLogger('organisations')
  const credentials = options.credentials
    ? { credentials: { ...options.credentials, namespace: NAMESPACE } }
    : {}
  const tenantSchema = readSchema('tenant')

  return openLocalDb({
    engines: options.engines,
    url: options.url,
    namespace: NAMESPACE,
    database: DIRECTORY,
    schema: readSchema('directory'),
    ...credentials,
  }).map((local): GatewayRoot => {
    const databases = new TenantDatabases({
      open: (key) =>
        openLocalDb({
          engines: options.engines,
          url: options.url,
          namespace: NAMESPACE,
          database: tenantDatabase(key),
          schema: tenantSchema,
          ...credentials,
        }),
      clock: options.clock,
      onError: (error) => tenantsLog.error({ code: error.code }, error.message),
    })
    const hub = new RegionHub({
      databases: regionDatabases(local, databases),
      schema: replicaSchema,
      clock: options.clock,
      onError: (error) => hubLog.error({ code: error.code }, error.message),
    })
    // The code and the gateway's own message, never the cause: a socket's text may hold anything.
    const connections = new ConnectionRegistry({
      onFailure: (error) => connectionsLog.error({ code: error.code }, error.message),
    })
    // A removal takes the organisation's region from the removed identity's connections before
    // anything else can fail, and a role change has them push as the new role right after the
    // directory's write; every change of memberships resolves once its devices were told, or
    // once a telling that failed is left to the re-tells (on the gateway's clock, logged as the
    // organisations' own). An invitation's link and its mail carry the same address of the front.
    const invitationLinkTo = (token: string) => invitationLink(options.publicUrl, token)
    const invitationMails = new InvitationMails({
      mail: options.mail,
      directory: local,
      link: invitationLinkTo,
      log: organisationsLog,
    })
    const organisations = new Organisations({
      directory: local,
      databases,
      revoke: (identity, region) => connections.revoke(identity, region),
      rerole: (identity, region, role) => connections.rerole(identity, region, role),
      hub,
      invitations: {
        pending: new PendingInvitations({
          directory: local,
          secret: options.authSecret,
          clock: options.clock,
        }),
        mailer: invitationMails,
        link: invitationLinkTo,
      },
      retell: { clock: options.clock, random: Math.random, log: organisationsLog },
    })

    organisations.onChange((identity, memberships) => connections.tell(identity, memberships))

    const departure = new AccountDeparture({ directory: local, databases, hub })

    // One account's work, one turn at a time: the auth mount's and the profile's email's.
    const accountTurns = new KeyedTurns<string>()

    // Better Auth serves its routes under the path of its public URL only, so the server hands it
    // each `/auth/<rest>` it receives at `${FRONT_PREFIX}/auth/<rest>`.
    const auth = createAuthInstance({
      local,
      secret: options.authSecret,
      baseURL: `${options.publicUrl}${FRONT_PREFIX}/auth`,
      trustedOrigins: [options.publicUrl],
      clock: options.clock,
      publicUrl: options.publicUrl,
      mail: options.mail,
      log: authLog,
    })

    return {
      auth,
      sessions: new AuthSessions({
        auth,
        directory: local,
        clock: options.clock,
        secret: options.authSecret,
      }),
      deviceSessions: new DeviceSessions({ directory: local, clock: options.clock }),
      passwords: new AccountPasswords({ auth, directory: local, clock: options.clock }),
      resets: new ResetLinks(local),
      emailChanges: new EmailChanges({
        directory: local,
        secret: options.authSecret,
        clock: options.clock,
      }),
      deletions: new AccountDeletions({
        directory: local,
        secret: options.authSecret,
        clock: options.clock,
      }),
      departure: {
        blocked: (identity) => departure.blocked(identity),
        leave: (identity, steps) => organisations.leaveAll(identity, steps),
      },
      teardown: new AccountTeardown(local),
      mails: new AccountMails({
        mail: options.mail,
        directory: local,
        publicUrl: options.publicUrl,
        log: authLog,
      }),
      profiles: new ProfileEmails({ directory: local, hub, log: authLog, turns: accountTurns }),
      organisations,
      databases,
      hub,
      schema: replicaSchema,
      connections,
      local,
      limits: new RequestLimits({ clock: options.clock }),
      accountTurns,
      clock: options.clock,
      close: async () => {
        // The re-tells stop first, the one running awaited, before anything they read or tell
        // through closes; then an invitation mail reads its recipient's language from the
        // directory before it closes.
        await organisations.close()
        await invitationMails.languagesRead()
        await hub.close()
        await databases.close()
        await local.close()
      },
    }
  })
}
