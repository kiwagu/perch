import type { DataError } from '@workspace/data'

import type { AuthSessions } from '../../auth/auth-sessions'
import type { AccountDirectory } from '../account-directory'

export interface ConsoleRoutesOptions {
  /** The caller read: who a request comes from, with the account's platform roles. */
  readonly sessions: Pick<AuthSessions, 'read'>
  /** The platform's accounts as the console reads them. */
  readonly accounts: Pick<AccountDirectory, 'list' | 'read'>
  /**
   * Hears each failure of the gateway a request was answered 500 for: the answer leaves the
   * failure out, so this is where it is told.
   */
  readonly onFailure: (error: DataError) => void
}
