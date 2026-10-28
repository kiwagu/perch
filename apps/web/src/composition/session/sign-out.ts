/**
 * Signing out: the sign-out the person asks for, through the gateway, and the one the gateway
 * forces on the device (refused keys, a sign-out from another device), without it. Either holds
 * every tab's writes back, then forgets the keys and deletes the identity's databases, or keeps
 * them for the next sign-in as the identity when they hold changes not sent yet.
 */

import { okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import type { OpenSpace } from '../open-space'
import type { KeysLeft, PendingRevoke } from '../pending-revoke'
import type { SpaceDeletion } from '../space-deletion'
import { forgetDevice, savedIdentity, saveNotice } from '../storage'
import type { WriteBarrier } from '../write-barrier'

import type { SessionHost } from './host'

export type SignOutOutcome = 'signed-out' | 'needs-confirmation'

export interface SessionSignOutOptions {
  readonly host: SessionHost
  readonly barrier: WriteBarrier
  readonly pendingRevoke: PendingRevoke
  readonly deletion: SpaceDeletion
}

export class SessionSignOut {
  readonly #host: SessionHost
  readonly #barrier: WriteBarrier
  readonly #pendingRevoke: PendingRevoke
  readonly #deletion: SpaceDeletion

  constructor(options: SessionSignOutOptions) {
    this.#host = options.host
    this.#barrier = options.barrier
    this.#pendingRevoke = options.pendingRevoke
    this.#deletion = options.deletion
  }

  /**
   * Raises the barrier that holds every tab's writes back before the final drain, lowers it
   * once the sign-out ends: after the database is deleted, or at once when it is kept. A
   * sign-out that leaves the person signed in (it asks first, or failed) after asking the
   * gateway in vain has the space sync again on a new engine: the old one stopped its channel.
   */
  signOut(forgetUnsent: boolean): ResultAsync<SignOutOutcome, DataError> {
    const open = this.#host.open()

    if (!open) {
      forgetDevice(this.#host.options.storage)

      return okAsync('signed-out')
    }

    const { space, leadership } = open

    this.#barrier.hold(open.hints)

    // The sign-out runs where the person asked for it: this tab leads from here on. The sync
    // engine answers `offline` without asking the gateway while anything stays unsent, a region
    // that stopped syncing included; what is unsent is then weighed here.
    const ended = ResultAsync.fromSafePromise(leadership?.takeOver() ?? Promise.resolve())
      .andThen(() =>
        ResultAsync.fromSafePromise(space.signOut({ online: this.#host.options.online() })),
      )
      // What is unsent is read, and the database deleted, only once no tab writes any more.
      // Keys the gateway did not revoke are left to revoke, whichever way they are forgotten.
      .andThen((outcome) =>
        this.#exclusively(
          open,
          () =>
            outcome === 'signed-out'
              ? this.#signedOut(open, forgetUnsent).map((): SignOutOutcome => 'signed-out')
              : this.#stillSignedIn(open, forgetUnsent),
          'signed-out',
          outcome === 'signed-out' ? 'dead' : 'live',
        ),
      )

    const release = () => {
      this.#barrier.release(open.hints)

      if (this.#host.open() === open) {
        open.space.resumeSync()
      }
    }

    return ended.andTee(release).orTee(release)
  }

  /** Signs out the saved identity whose space did not open; see `SessionService.signOutUnopened`. */
  unopened(): ResultAsync<void, DataError> {
    const identity = savedIdentity(this.#host.options.storage)

    if (!identity || this.#host.open()) {
      return okAsync(undefined)
    }

    this.#pendingRevoke.forgetKeys('live')

    return this.#deletion.deleteUnopened(identity.id).map(() => undefined)
  }

  /**
   * The gateway refused the identity's keys, which will not work again, or signed the device
   * out from another one: the device signs out here, without the gateway, behind the same write
   * barrier as a sign-out, and leaves nothing to revoke. Its data for the identity goes with the
   * keys only when nothing in it waits to be sent, and the sign-in page then says `notice`, if
   * any; otherwise (or when that cannot be read) the database stays, and the sign-in page says
   * that signing in again as the identity sends the changes.
   */
  refused(identity: IdentityId, notice?: 'signed-out-elsewhere'): ResultAsync<void, DataError> {
    const open = this.#host.open()
    const storage = this.#host.options.storage

    if (open?.space.identity.id !== identity) {
      return okAsync(undefined)
    }

    // Another tab changed who is signed in: what happens to this identity's data is its call.
    if (savedIdentity(storage)?.id !== identity) {
      this.#host.leaveAndTell()

      return okAsync(undefined)
    }

    // As in a sign-out, every tab's writes are held back, and what is unsent is read and the
    // database deleted once no tab writes any more. A database kept says so in place of `notice`.
    this.#barrier.hold(open.hints)

    if (notice) {
      saveNotice(storage, notice)
    }

    const release = () => this.#barrier.release(open.hints)

    return this.#exclusively(
      open,
      () =>
        this.#unsentOrUnknown(open).andThen((unsent) =>
          unsent ? okAsync(this.#keepForNextSignIn(open, 'dead')) : this.#forgetSpace(open, 'dead'),
        ),
      undefined,
      'dead',
    )
      .andTee(release)
      .orTee(release)
  }

  /**
   * The gateway signed the device out. A write that passed the barrier before it went up (in
   * another tab, before it heard of the sign-out) may have landed after the final drain: the
   * database goes only with an empty outbox, or when the person gave unsent changes up.
   * Otherwise it stays for the next sign-in as the identity, which sends what it holds.
   */
  #signedOut(open: OpenSpace, forgetUnsent: boolean): ResultAsync<void, DataError> {
    if (forgetUnsent) {
      return this.#forgetSpace(open, 'dead')
    }

    return this.#unsentOrUnknown(open).andThen((unsent) =>
      unsent ? okAsync(this.#keepForNextSignIn(open, 'dead')) : this.#forgetSpace(open, 'dead'),
    )
  }

  /**
   * The engine could not have the gateway sign the device out: offline, or with changes it
   * could not send. With such changes it asks first; without them the device signs out here,
   * leaving its keys to revoke once online.
   */
  #stillSignedIn(open: OpenSpace, forgetUnsent: boolean): ResultAsync<SignOutOutcome, DataError> {
    return (forgetUnsent ? okAsync(false) : open.space.unsent()).andThen((asks) =>
      asks
        ? okAsync<SignOutOutcome>('needs-confirmation')
        : this.#forgetSpace(open, 'live').map((): SignOutOutcome => 'signed-out'),
    )
  }

  /**
   * Runs `work` once every write a tab admitted is durable, holding the identity's write lock
   * exclusive (`WriteBarrier.exclusively`). A tab that never lets its write go deletes nothing:
   * the keys are forgotten (`keys` says whether they still work) and the database is kept for
   * the next sign-in, as when the gateway refuses the keys; that ends as `kept`.
   */
  #exclusively<T>(
    open: OpenSpace,
    work: () => ResultAsync<T, DataError>,
    kept: T,
    keys: KeysLeft,
  ): ResultAsync<T, DataError> {
    return this.#barrier.exclusively(open.space.identity.id, work, () => {
      this.#keepForNextSignIn(open, keys)

      return kept
    })
  }

  /**
   * Forgets the device's identity and keys, leaving live keys to revoke, then deletes the
   * identity's databases. The other tabs hear the identity go and close their own spaces, which
   * lets the stores be deleted. A delete another tab still holds up after a few seconds goes on
   * (`SpaceDeletion`), and the sign-in page says the data goes once the other tabs are closed;
   * this tab hears of the sign-out once the delete answered, so that page reads the word.
   */
  #forgetSpace(open: OpenSpace, keys: KeysLeft): ResultAsync<void, DataError> {
    this.#pendingRevoke.forgetKeys(keys)

    const current = this.#host.open() === open
    const tell = () => current && this.#host.emit(undefined)

    if (current) {
      this.#host.drop(open)
    }

    const deleted = this.#deletion
      .destroy(open.space)
      .map(() => undefined)
      .andTee(tell)
      .orTee(tell)

    this.#host.retire(Promise.resolve(deleted).then(() => undefined))

    return deleted
  }

  /** Whether the space holds changes not sent yet; an outbox that cannot be read is reported and counts. */
  #unsentOrUnknown(open: OpenSpace): ResultAsync<boolean, DataError> {
    return open.space.unsent().orElse((error) => {
      this.#host.options.onError(error)

      return okAsync(true)
    })
  }

  /**
   * Forgets the keys, leaving live ones to revoke, and closes the space, keeping its database
   * with the changes it holds: the sign-in page says that signing in again as the identity
   * sends them.
   */
  #keepForNextSignIn(open: OpenSpace, keys: KeysLeft): void {
    saveNotice(this.#host.options.storage, 'resend-after-sign-in')
    this.#pendingRevoke.forgetKeys(keys)

    if (this.#host.open() === open) {
      this.#host.leaveAndTell()
    }
  }
}
