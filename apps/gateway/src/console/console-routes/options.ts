import type { DataError } from '@workspace/data'

import type { AuthSessions } from '../../auth/auth-sessions'
import type { KeyedTurns } from '../../keyed-turns'
import type { ConnectionRegistry } from '../../sync/connections'
import type { AccountBans } from '../account-bans'
import type { AccountDirectory } from '../account-directory'

export interface ConsoleRoutesOptions {
  /**
   * The caller read: who a request comes from, with the account's platform roles; and the end of
   * every session of an account, as its own sign-out everywhere ends them.
   */
  readonly sessions: Pick<AuthSessions, 'read' | 'revokeAll'>
  /** The platform's accounts as the console reads them. */
  readonly accounts: Pick<AccountDirectory, 'list' | 'read'>
  /** The bans of accounts: set with the end of every session, and lifted. */
  readonly bans: Pick<AccountBans, 'ban' | 'unban'>
  /** The open sync connections of each account, closed once its sessions ended. */
  readonly connections: Pick<ConnectionRegistry, 'close'>
  /**
   * One account's work, one turn at a time, keyed by its identity's key: the turns the auth
   * mount's changes of an account take, so an operator's action never runs beside them or
   * beside another operator's action on the same account.
   */
  readonly turns: Pick<KeyedTurns<string>, 'run'>
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}
