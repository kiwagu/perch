/**
 * How a session's space ends on this device once its sign-out has decided: its keys forgotten,
 * and its databases deleted, or kept for the next sign-in as the identity when they hold changes
 * not sent yet, with the words the sign-in page says of it. Every word names the last sign-in on
 * the browser as the session ended (`raised`, its `signInMark`): a sign-in made since ends it,
 * however late it comes.
 */

import { okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import type { SessionNotice } from '../../../platform/session.port'
import { saveNotice } from '../../storage'
import type { SessionHost } from '../host'
import type { OpenSpace } from '../open-space'
import type { KeysLeft, PendingRevoke } from '../pending-revoke'
import type { SpaceDeletion } from '../space-deletion'

export interface SpaceEndingOptions {
  readonly host: SessionHost
  readonly pendingRevoke: PendingRevoke
  readonly deletion: SpaceDeletion
}

export class SpaceEnding {
  readonly #host: SessionHost
  readonly #pendingRevoke: PendingRevoke
  readonly #deletion: SpaceDeletion

  constructor(options: SpaceEndingOptions) {
    this.#host = options.host
    this.#pendingRevoke = options.pendingRevoke
    this.#deletion = options.deletion
  }

  /**
   * Forgets the device's identity and token, leaving a live token to sign out, then deletes the
   * identity's databases, the sign-in page saying `notice`, if any. The other tabs hear the
   * identity go and close their own spaces, which lets the stores be deleted. A delete another
   * tab still holds up after a few seconds goes on (`SpaceDeletion`), and the sign-in page says
   * the data goes once the other tabs are closed; this tab hears of the sign-out once the delete
   * answered, so that page reads the word.
   */
  forget(
    open: OpenSpace,
    keys: KeysLeft,
    raised: string,
    notice?: SessionNotice,
  ): ResultAsync<void, DataError> {
    if (notice) {
      saveNotice(this.#host.options.storage, notice, raised)
    }

    this.#pendingRevoke.forgetKeys(keys)

    const current = this.#host.open() === open
    const tell = () => current && this.#host.emit(undefined)

    if (current) {
      this.#host.drop(open)
    }

    const deleted = this.#deletion
      .destroy(open.space, raised)
      .map(() => undefined)
      .andTee(tell)
      .orTee(tell)

    this.#host.retire(Promise.resolve(deleted).then(() => undefined))

    return deleted
  }

  /**
   * Forgets the token, leaving a live one to sign out, and closes the space, keeping its database
   * with the changes it holds: the sign-in page says that signing in again as the identity
   * sends them, unless `notice`, the word of the ending that kept it, ranks above that one
   * (`account-banned`). Both words are left, and the page says the first by the rank of
   * `SESSION_NOTICES` (`savedNotice`): the order is kept in that list alone.
   */
  keep(open: OpenSpace, keys: KeysLeft, raised: string, notice?: SessionNotice): void {
    saveNotice(this.#host.options.storage, 'resend-after-sign-in', raised)

    if (notice) {
      saveNotice(this.#host.options.storage, notice, raised)
    }

    this.#pendingRevoke.forgetKeys(keys)

    if (this.#host.open() === open) {
      this.#host.leaveAndTell()
    }
  }

  /** Whether the space holds changes not sent yet; an outbox that cannot be read is reported and counts. */
  unsentOrUnknown(open: OpenSpace): ResultAsync<boolean, DataError> {
    return open.space.unsent().orElse((error) => {
      this.#host.options.onError(error)

      return okAsync(true)
    })
  }
}
