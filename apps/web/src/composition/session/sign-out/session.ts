/**
 * Signing out: the sign-out the person asks for, through the gateway, and the one the gateway
 * forces on the device (a refused token, a sign-out from another device), without it. Either
 * holds every tab's writes back, then has the space end (`SpaceEnding`): its token forgotten and
 * the identity's databases deleted, or kept for the next sign-in as the identity when they hold
 * changes not sent yet. Each names, as it begins, the last sign-in on the browser (`signInMark`),
 * and every word it leaves the sign-in page names that one: a sign-in made while it waits ends
 * them, however late they come.
 */

import { okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { forgetDevice, savedIdentity, savedToken, signInMark } from '../../storage'
import type { SessionHost } from '../host'
import type { OpenSpace } from '../open-space'
import type { KeysLeft, PendingRevoke } from '../pending-revoke'
import type { SpaceDeletion } from '../space-deletion'
import type { WriteBarrier } from '../write-barrier'

import { SpaceEnding } from './space'

export type SignOutOutcome = 'signed-out' | 'needs-confirmation'

/** Why the gateway signed the device out, as the sign-in page says it. */
export type ElsewhereNotice = 'signed-out-elsewhere' | 'password-changed-elsewhere'

/** How a forced sign-out ended: done, or left to a sign-in another tab made while it waited. */
export type ForcedSignOut = 'signed-out' | 'signed-in-since'

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
  readonly #ending: SpaceEnding

  constructor(options: SessionSignOutOptions) {
    this.#host = options.host
    this.#barrier = options.barrier
    this.#pendingRevoke = options.pendingRevoke
    this.#deletion = options.deletion
    this.#ending = new SpaceEnding(options)
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
    const raised = signInMark(this.#host.options.storage)

    this.#barrier.hold(open.hints)

    // The sign-out runs where the person asked for it: this tab leads from here on. The sync
    // engine answers `offline` without asking the gateway while anything stays unsent, a region
    // that stopped syncing included; what is unsent is then weighed here.
    const ended = ResultAsync.fromSafePromise(leadership?.takeOver() ?? Promise.resolve())
      .andThen(() =>
        ResultAsync.fromSafePromise(space.signOut({ online: this.#host.options.online() })),
      )
      // What is unsent is read, and the database deleted, only once no tab writes any more.
      // A token the gateway did not sign out is left to sign out, whichever way it is forgotten.
      .andThen((outcome) =>
        this.#exclusively(
          open,
          () =>
            outcome === 'signed-out'
              ? this.#signedOut(open, forgetUnsent, raised).map((): SignOutOutcome => 'signed-out')
              : this.#stillSignedIn(open, forgetUnsent, raised),
          'signed-out',
          outcome === 'signed-out' ? 'dead' : 'live',
          raised,
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

  /** Signs out `identity`, still the saved one, whose space did not open; see `SessionService.signOutUnopened`. */
  unopened(identity: IdentityId): ResultAsync<void, DataError> {
    if (savedIdentity(this.#host.options.storage)?.id !== identity || this.#host.open()) {
      return okAsync(undefined)
    }

    const raised = signInMark(this.#host.options.storage)

    this.#pendingRevoke.forgetKeys('live')

    return this.#deletion.deleteUnopened(identity, raised).map(() => undefined)
  }

  /**
   * The gateway refused the identity's token, which will not work again, or signed the device
   * out from another one or because the account's password changed: the device signs out here,
   * without the gateway, behind the same write
   * barrier as a sign-out, and leaves nothing to sign out. Its data for the identity goes with the
   * token only when nothing in it waits to be sent, and the sign-in page then says `notice`, if
   * any; otherwise (or when that cannot be read) the database stays, and the sign-in page says
   * that signing in again as the identity sends the changes. A token another tab saves while it
   * waits for the writes or reads the outbox is a sign-in made since, which keeps the data and the
   * keys (`signed-in-since`): this tab only leaves its space, for its caller to follow it.
   */
  refused(identity: IdentityId, notice?: ElsewhereNotice): ResultAsync<ForcedSignOut, DataError> {
    const open = this.#host.open()
    const storage = this.#host.options.storage
    const raised = signInMark(storage)

    if (open?.space.identity.id !== identity) {
      return okAsync('signed-out')
    }

    // Another tab changed who is signed in: what happens to this identity's data is its call.
    if (savedIdentity(storage)?.id !== identity) {
      this.#host.leaveAndTell()

      return okAsync('signed-out')
    }

    const ended = savedToken(storage)
    // Judged again right before anything is forgotten, with nothing awaited in between.
    const signedInSince = () => this.#signedInSince(open, ended)

    // As in a sign-out, every tab's writes are held back, and what is unsent is read and the
    // database deleted once no tab writes any more. A database kept says so in place of `notice`.
    this.#barrier.hold(open.hints)

    const release = () => this.#barrier.release(open.hints)
    const keep = (): ForcedSignOut => {
      if (signedInSince()) {
        return 'signed-in-since'
      }

      this.#ending.keep(open, 'dead', raised)

      return 'signed-out'
    }

    return this.#barrier
      .exclusively(
        identity,
        () =>
          this.#ending
            .unsentOrUnknown(open)
            .andThen(
              (unsent): ResultAsync<ForcedSignOut, DataError> =>
                unsent || signedInSince()
                  ? okAsync(unsent ? keep() : 'signed-in-since')
                  : this.#ending
                      .forget(open, 'dead', raised, notice)
                      .map((): ForcedSignOut => 'signed-out'),
            ),
        keep,
      )
      .andTee(release)
      .orTee(release)
  }

  /**
   * Whether another tab saved a token since `ended`, the one the forced sign-out ends, signing in
   * again: this tab then lifts the barrier while its hints are open (they close with its space),
   * and leaves its space, keeping the data and the keys.
   */
  #signedInSince(open: OpenSpace, ended: string | undefined): boolean {
    const token = savedToken(this.#host.options.storage)

    if (token === undefined || token === ended) {
      return false
    }

    this.#barrier.release(open.hints)

    if (this.#host.open() === open) {
      this.#host.leaveAndTell()
    }

    return true
  }

  /**
   * The gateway signed the device out. A write that passed the barrier before it went up (in
   * another tab, before it heard of the sign-out) may have landed after the final drain: the
   * database goes only with an empty outbox, or when the person gave unsent changes up.
   * Otherwise it stays for the next sign-in as the identity, which sends what it holds.
   */
  #signedOut(open: OpenSpace, forgetUnsent: boolean, raised: string): ResultAsync<void, DataError> {
    if (forgetUnsent) {
      return this.#ending.forget(open, 'dead', raised)
    }

    return this.#ending
      .unsentOrUnknown(open)
      .andThen((unsent) =>
        unsent
          ? okAsync(this.#ending.keep(open, 'dead', raised))
          : this.#ending.forget(open, 'dead', raised),
      )
  }

  /**
   * The engine could not have the gateway sign the device out: offline, or with changes it
   * could not send. With such changes it asks first; without them the device signs out here,
   * leaving its token to sign out once online.
   */
  #stillSignedIn(
    open: OpenSpace,
    forgetUnsent: boolean,
    raised: string,
  ): ResultAsync<SignOutOutcome, DataError> {
    return (forgetUnsent ? okAsync(false) : open.space.unsent()).andThen((asks) =>
      asks
        ? okAsync<SignOutOutcome>('needs-confirmation')
        : this.#ending.forget(open, 'live', raised).map((): SignOutOutcome => 'signed-out'),
    )
  }

  /**
   * Runs `work` once every write a tab admitted is durable, holding the identity's write lock
   * exclusive (`WriteBarrier.exclusively`). A tab that never lets its write go deletes nothing:
   * the token is forgotten (`keys` says whether it still works) and the database is kept for
   * the next sign-in, as when the gateway refuses the token; that ends as `kept`.
   */
  #exclusively<T>(
    open: OpenSpace,
    work: () => ResultAsync<T, DataError>,
    kept: T,
    keys: KeysLeft,
    raised: string,
  ): ResultAsync<T, DataError> {
    return this.#barrier.exclusively(open.space.identity.id, work, () => {
      this.#ending.keep(open, keys, raised)

      return kept
    })
  }
}
