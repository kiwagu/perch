import type { ResultAsync } from 'neverthrow'

import type { DataError, LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'

import { type AccountAddressee, accountAddressee } from './account-addressee'
import { writing } from './device-session-rows'
import accountTeardownStatement from './surql/account-teardown.surql'

/** Whom the notice of a deleted account goes to, read while the account still exists. */
export type DeletedAccount = AccountAddressee

/**
 * What a deleted account leaves of itself in the directory. `addressee` reads whom the notice of
 * the deletion goes to, as every mail about the account reads it (`accountAddressee`), so it is
 * read before the rows go. `remove` deletes every row of the account in one transaction, the
 * identity last: its sessions, its credential row, every pending link of it (a change of its
 * email, a deletion of the account, its reset links), its profile and settings, and the server's
 * copy of its private region (head, snapshots, update log, projected records, bound peers). All
 * of them go or none does, and removing an account that is gone already deletes nothing and
 * succeeds, so a deletion that stopped half way can run again.
 *
 * The caller ends the account's sessions and closes its sockets first, so no device holds the
 * private region open while its rows go: an idle region unloads without writing, so the region
 * hub is not called. The caller also takes the account out of its organisations
 * (`Organisations.leaveAll`) first: memberships, organisations and their databases are not
 * touched here. A membership of the identity still in the directory refuses the removal, a data
 * error with nothing deleted, rather than leave a membership of an account that no longer exists
 * or an organisation without the admin it had.
 */
export class AccountTeardown {
  readonly #directory: LocalDb

  constructor(directory: LocalDb) {
    this.#directory = directory
  }

  /**
   * The notice's addressee: the account's email, its own name and the language it reads (its
   * settings', its sign-up's before it has settings). An identity that is gone, or settings that
   * could not be read, fail.
   */
  addressee(identity: IdentityId): ResultAsync<DeletedAccount, DataError> {
    return accountAddressee(this.#directory, identity).mapErr(({ error }) => error)
  }

  /** Every row of the account in the directory goes, in one transaction, the identity last. */
  remove(identity: IdentityId): ResultAsync<void, DataError> {
    return writing(
      this.#directory.db
        .query(accountTeardownStatement, { identity, region: privateRegionId(identity) })
        .retry(),
      `the rows of the account of ${identity} could not be removed`,
    ).map(() => undefined)
  }
}
