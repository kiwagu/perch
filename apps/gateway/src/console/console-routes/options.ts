import type { DataError } from '@workspace/data'

import type { EmailChanges } from '../../auth/account-links'
import type { AccountMails } from '../../auth/account-mails'
import type { AccountPasswords } from '../../auth/account-passwords'
import type { AccountTeardown } from '../../auth/account-teardown'
import type { AccountDepartures } from '../../auth/auth-handler'
import type { AuthInstance } from '../../auth/auth-instance'
import type { AuthSessions } from '../../auth/auth-sessions'
import type { KeyedTurns } from '../../keyed-turns'
import type { RequestLimits } from '../../limits/request-limits'
import type { ConnectionRegistry } from '../../sync/connections'
import type { AccountBans } from '../account-bans'
import type { AccountDirectory } from '../account-directory'
import type { ProfileNames } from '../profile-names'

export interface ConsoleRoutesOptions {
  /**
   * The caller read: who a request comes from, with the account's platform roles; the account an
   * email signs in to; and the end of every session of an account, as its own sign-out everywhere
   * ends them.
   */
  readonly sessions: Pick<AuthSessions, 'read' | 'revokeAll' | 'identityOf'>
  /** The platform's accounts as the console reads them. */
  readonly accounts: Pick<AccountDirectory, 'list' | 'read'>
  /** The bans of accounts: set with the end of every session, and lifted. */
  readonly bans: Pick<AccountBans, 'ban' | 'unban'>
  /** The name of an account's profile, written through its private region. */
  readonly names: Pick<ProfileNames, 'rename'>
  /** The pending change of an account's email: the earlier one ended, a new one kept. */
  readonly emailChanges: Pick<EmailChanges, 'ask' | 'cancel'>
  /** The reset mail, asked of Better Auth on the server as the account's own request asks it. */
  readonly passwords: Pick<AccountPasswords, 'requestReset'>
  /** Better Auth, asked to send an account's verification mail again as a visitor asks it. */
  readonly auth: Pick<AuthInstance, 'handler'>
  /** The confirmation of a new email, and the notice of a removed account. */
  readonly mails: Pick<AccountMails, 'confirmEmail' | 'accountDeleted'>
  /**
   * The mails each client address and each account may send: an operator's mails count against
   * its own address, and against the account's allowances as the account's own requests do.
   */
  readonly limits: Pick<RequestLimits, 'emailChangeMail' | 'resetMail' | 'verificationMail'>
  /**
   * The organisations a removed account leaves, in the turns of its memberships
   * (`Organisations.leaveAll`), as its own deletion leaves them.
   */
  readonly departure: Pick<AccountDepartures, 'leave'>
  /** Whom the notice of a removed account goes to, and the removal of the account's own rows. */
  readonly teardown: Pick<AccountTeardown, 'addressee' | 'remove'>
  /** The open sync connections of each account, closed once its sessions ended. */
  readonly connections: Pick<ConnectionRegistry, 'close'>
  /**
   * One account's work, one turn at a time: the turns the auth mount's changes of an account take,
   * by its identity's key and by its email in lower case, so an operator's action never runs
   * beside them or beside another operator's action on the same account. An action that needs
   * the email takes the email's turn inside the identity's, as the mount's confirmation of a new
   * email does, never the other way round.
   */
  readonly turns: Pick<KeyedTurns<string>, 'run'>
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}
