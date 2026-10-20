import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'
import { leadership, lockName } from '@workspace/replica/sync'

import type {
  PushRejection,
  SessionNotice,
  SessionPort,
  SignOutOptions,
} from '../platform/session.port'

import { CurrentSpaceRunner, CurrentSpaceWritePath, type SpaceSource } from './current-space'
import type { NamedDevice, SignedInDevice } from './gateway-auth'
import { type IdentitySpace, openIdentitySpace, type SyncState } from './identity-space'
import type { OpenSpace, SpaceStatus } from './open-space'
import { SessionOrganisations } from './organisations'
import { type KeysLeft, PendingRevoke } from './pending-revoke'
import { rejectionOf } from './push-rejection'
import type { SessionOptions, TransportContext } from './session-options'
import { sessionTransportContext } from './session-transport-context'
import { type DeleteOutcome, SpaceDeletion } from './space-deletion'
import {
  deviceIdFrom,
  forgetDevice,
  forgetNotice,
  IDENTITY_KEY,
  MEMBERSHIPS_KEY,
  saveDevice,
  savedIdentity,
  savedNotice,
  saveNotice,
} from './storage'
import { type HeardSignOut, WriteBarrier } from './write-barrier'

type SignOutOutcome = 'signed-out' | 'needs-confirmation'

const NOT_SYNCING: SyncState = { leader: false, channel: 'down' }

const closedDuringSignIn = () =>
  dataError('data:AUTH_FAILED', 'the session was closed during this sign-in')

/**
 * The signed-in identity and its space. Signing up or in goes through the gateway, naming the
 * device (its id and label), keeps the identity and its keys in the browser's storage and
 * opens the identity's space; restoring opens the saved identity's space without the network.
 * Signing out drains and has the gateway sign the device out, then forgets the keys and
 * deletes the identity's databases, its own and every organisation database the device holds
 * for it; with changes that cannot be sent it asks first. A sign-out the gateway did not
 * confirm leaves the pair to revoke once online (`PendingRevoke`). Keys the gateway refuses,
 * or a sign-out from another device, sign the device out without it; the database goes too
 * unless it holds changes not sent yet, which wait for the next sign-in as the identity. The
 * tabs of a browser follow the saved identity: when another tab signs it out, this one closes
 * its space. While a sign-out runs, no tab of the browser takes a write: a write landing after
 * the final drain would go with the database.
 */
export class SessionService implements SessionPort {
  readonly runner: CurrentSpaceRunner
  readonly writePath: CurrentSpaceWritePath
  readonly #options: SessionOptions
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  readonly #rejections = new Set<(rejection: PushRejection) => void>()
  readonly #organisations: SessionOrganisations
  readonly #barrier: WriteBarrier
  readonly #pendingRevoke: PendingRevoke
  readonly #deletion: SpaceDeletion
  readonly #unlisten: Array<() => void>
  #open: OpenSpace | undefined
  #generation = 0
  #transitions: Promise<unknown> = Promise.resolve()
  #closed = false
  #retiring: Promise<unknown> = Promise.resolve()

  constructor(options: SessionOptions) {
    this.#options = options
    this.#organisations = new SessionOrganisations({
      storage: options.storage,
      clock: options.clock,
      open: () => this.#open,
    })
    this.#barrier = new WriteBarrier({
      locks: options.locks,
      clock: options.clock,
      storage: options.storage,
      onError: options.onError,
    })
    this.#pendingRevoke = new PendingRevoke({
      auth: options.auth,
      storage: options.storage,
      online: options.online,
      onError: options.onError,
    })
    this.#deletion = new SpaceDeletion({
      storage: options.storage,
      clock: options.clock,
      deleteLocal: options.deleteLocal,
      deleteTenantLocal: options.deleteTenantLocal,
      inventory: (identity) => this.#organisations.databases(identity),
      onError: options.onError,
    })

    const spaces: SpaceSource = {
      current: () => this.#open?.space,
      onSwitch: (listener) => this.subscribe(() => listener()),
      signingOut: () => this.#barrier.signingOut(this.#open?.heard),
      writing: (space, work) => this.#barrier.writing(space.identity.id, work),
    }

    this.runner = new CurrentSpaceRunner(spaces)
    this.writePath = new CurrentSpaceWritePath(spaces)
    this.#unlisten = [
      options.storage.onChangeElsewhere((key) => {
        if (key === undefined || key === IDENTITY_KEY) {
          this.#followElsewhere()
        } else if (key === MEMBERSHIPS_KEY) {
          this.#organisations.followSaved()
        }
      }),
      options.visibility.onChange((state) => this.#open?.space.visibility(state)),
    ]
  }

  current(): AuthUser | undefined {
    return this.#open?.space.identity
  }

  space(): IdentitySpace | undefined {
    return this.#open?.space
  }

  subscribe(listener: (user: AuthUser | undefined) => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError> {
    return this.#serially((generation) =>
      this.#revokeLeftPair()
        .andThen(() => this.#options.auth.signUp(input, this.#device()))
        .andThen((device) => this.#enter(device, generation)),
    )
  }

  signIn(input: SignInInput): ResultAsync<AuthUser, DataError> {
    return this.#serially((generation) =>
      this.#revokeLeftPair()
        .andThen(() => this.#options.auth.signIn(input, this.#device()))
        .andThen((device) => this.#enter(device, generation)),
    )
  }

  signOut(options: SignOutOptions = {}): ResultAsync<SignOutOutcome, DataError> {
    return this.#serially(() => this.#signOut(options.forgetUnsent ?? false))
  }

  /**
   * Names the session open now, before it asks the gateway to sign every device of the identity
   * out; what it returns signs that session out once the gateway did, as on the channel's 4001,
   * which it may never hear (no Web Locks, or its WebSocket blocked). A late answer finds the
   * session ended (the 4001 came first) and changes nothing, whoever signed in since.
   */
  signingOutEverywhere(): () => ResultAsync<void, DataError> {
    const asking = this.#open
    const still = () => asking !== undefined && this.#open === asking

    return () =>
      ResultAsync.fromSafePromise(
        asking && still() ? this.#outElsewhere(asking.space.identity.id, still) : Promise.resolve(),
      )
  }

  /**
   * Opens the space of the identity saved by an earlier sign-in; the network is not needed.
   * Online, a pair a sign-out left to revoke is sent meanwhile.
   */
  restore(): ResultAsync<AuthUser | undefined, DataError> {
    return this.#serially((generation): ResultAsync<AuthUser | undefined, DataError> => {
      const storage = this.#options.storage
      const identity = savedIdentity(storage)

      if (this.#options.online()) {
        void this.#pendingRevoke.send()
      }

      // What sign-outs left behind goes meanwhile: the databases of anyone but `identity`.
      void this.#deletion.deleteLeftovers()

      if (identity) {
        return this.#openSpace(identity, generation)
      }

      // A kept value that names nobody is not a session.
      if (storage.get(IDENTITY_KEY) !== undefined) {
        forgetDevice(storage)
      }

      return okAsync(undefined)
    })
  }

  /**
   * The saved identity's space did not open: signs it out on this device without it. Its keys
   * are left to revoke (sent at once online) and its databases deleted, its own and every
   * organisation one counted for it, with whatever they held that was not sent. Changes nothing
   * while a space is open or nobody is saved.
   */
  signOutUnopened(): ResultAsync<void, DataError> {
    return this.#serially(() => {
      const identity = savedIdentity(this.#options.storage)

      if (!identity || this.#open) {
        return okAsync(undefined)
      }

      this.#pendingRevoke.forgetKeys('live')

      return this.#deletion.deleteUnopened(identity.id).map((outcome) => this.#noticeIf(outcome))
    })
  }

  /** Resolves once every local write so far is durable and projected; reports one that is not durable. */
  flush(): ResultAsync<void, DataError> {
    return this.#open?.space.flush() ?? okAsync(undefined)
  }

  notice(): SessionNotice | undefined {
    return savedNotice(this.#options.storage)
  }

  clearNotice(): void {
    forgetNotice(this.#options.storage)
  }

  memberships(): readonly Membership[] {
    return this.#organisations.memberships()
  }

  subscribeMemberships(listener: () => void): () => void {
    return this.#organisations.subscribe(listener)
  }

  currentTenant(): Membership | undefined {
    return this.#organisations.current()
  }

  selectTenant(key: string): void {
    this.#organisations.select(key)
  }

  subscribeRejections(listener: (rejection: PushRejection) => void): () => void {
    this.#rejections.add(listener)

    return () => {
      this.#rejections.delete(listener)
    }
  }

  /** Reports an error of the space; a refused push is also told to the rejection listeners. */
  #report(error: DataError): void {
    const rejection = rejectionOf(error)

    if (rejection) {
      for (const listener of this.#rejections) {
        listener(rejection)
      }
    }

    this.#options.onError(error)
  }

  /** Keeps the signed-in identity's new memberships and has its space follow them; see `SessionOrganisations.apply`. */
  applyMemberships(next: readonly Membership[]): Promise<void> {
    return this.#organisations.apply(next)
  }

  /** Has the gateway renew the device's keys, through the leading tab; see `SessionOrganisations.renewKeys`. */
  renewKeys(): Promise<boolean> {
    return this.#organisations.renewKeys()
  }

  /**
   * Closes the space, keeping the saved keys, and resolves once its last writes are persisted
   * and projected and its database is closed (or deleted, by a sign-out under way).
   */
  async close(): Promise<void> {
    this.#closed = true
    this.#begin()

    for (const stop of this.#unlisten.splice(0)) {
      stop()
    }

    this.#leaveAndTell()
    await this.#retiring
  }

  /** This browser as a sign-up or sign-in names it. */
  #device(): NamedDevice {
    return { id: deviceIdFrom(this.#options.storage), label: this.#options.deviceLabel }
  }

  /**
   * Has a pair a sign-out left be revoked before a sign-in: the sign-in moves the device's
   * session at the gateway to a new grant, after which the old pair matches it no more.
   */
  #revokeLeftPair(): ResultAsync<void, never> {
    return ResultAsync.fromSafePromise(this.#pendingRevoke.send())
  }

  /** Starts a session transition; a transition that finishes after a later one began is dropped. */
  #begin(): number {
    this.#generation += 1

    return this.#generation
  }

  /**
   * Runs session transitions one at a time, each when the previous one has finished, so the
   * saved keys and the space never serve two transitions at once. `close` does not wait: it
   * starts a new generation, so a transition still running attaches nothing, and the queued
   * ones do not run.
   */
  #serially<T>(run: (generation: number) => ResultAsync<T, DataError>): ResultAsync<T, DataError> {
    // A closed session runs nothing more, transitions queued before the close included.
    const result = this.#transitions.then(() =>
      this.#closed
        ? errAsync(dataError('data:AUTH_FAILED', 'the session is closed'))
        : run(this.#begin()),
    )

    this.#transitions = result.then(
      () => undefined,
      () => undefined,
    )

    return new ResultAsync(result)
  }

  #enter(device: SignedInDevice, generation: number): ResultAsync<AuthUser, DataError> {
    if (generation !== this.#generation) {
      return errAsync(closedDuringSignIn())
    }

    // The keys are kept first: the space's channel presents them as soon as this tab leads.
    saveDevice(this.#options.storage, device)

    return this.#openSpace(device.identity, generation).orElse((error) => {
      if (generation === this.#generation) {
        forgetDevice(this.#options.storage)
      }

      return errAsync(error)
    })
  }

  #openSpace(identity: AuthUser, generation: number): ResultAsync<AuthUser, DataError> {
    // The previous identity leaves with its space: nobody is current until the new one is open.
    this.#leaveAndTell()
    this.#options.onStep?.('open-db')

    // A delete of the identity's databases this page runs ends first, as the browser would have it.
    return ResultAsync.fromSafePromise(this.#deletion.beforeOpen(identity.id)).andThen(() =>
      this.#openSpaceNow(identity, generation),
    )
  }

  #openSpaceNow(identity: AuthUser, generation: number): ResultAsync<AuthUser, DataError> {
    const status: SpaceStatus = { live: true }
    const lead = leadership(this.#options.locks, lockName(identity.id))
    const hints = this.#options.hints(identity.id)
    const heard: HeardSignOut = { at: undefined }

    // Another tab's sign-out holds this tab's writes back until it ends; the space closes the hints.
    hints.on((hint) => this.#barrier.hear(heard, hint))

    return openIdentitySpace({
      identity,
      openLocal: this.#options.openLocal,
      openTenantLocal: this.#options.openTenantLocal,
      deleteTenantLocal: this.#options.deleteTenantLocal,
      tenantDatabases: this.#organisations.databases(identity.id),
      ...this.#organisations.saved(identity.id),
      schema: this.#options.schema,
      transport: () => this.#options.transport(this.#transportContext(identity.id)),
      leadership: lead,
      hints,
      clock: this.#options.clock,
      onState: (state) => {
        if (status.live) {
          this.#options.onSyncState(state)
        }
      },
      onError: (error) => this.#report(error),
    })
      .mapErr((error) => {
        status.live = false

        return error
      })
      .andThen((space) => {
        if (generation !== this.#generation) {
          status.live = false
          this.#retire(space.close())

          return err(closedDuringSignIn())
        }

        this.#open = { space, leadership: lead, status, hints, heard }
        space.visibility(this.#options.visibility.current())
        this.#options.onStep?.('ready')
        this.#emit(identity)

        return ok(identity)
      })
  }

  /**
   * Raises the barrier that holds every tab's writes back before the final drain, lowers it
   * once the sign-out ends: after the database is deleted, or at once when it is kept. A
   * sign-out that leaves the person signed in (it asks first, or failed) after asking the
   * gateway in vain has the space sync again on a new engine: the old one stopped its channel.
   */
  #signOut(forgetUnsent: boolean): ResultAsync<SignOutOutcome, DataError> {
    const open = this.#open

    if (!open) {
      forgetDevice(this.#options.storage)

      return okAsync('signed-out')
    }

    const { space, leadership } = open

    this.#barrier.hold(open.hints)

    // The sign-out runs where the person asked for it: this tab leads from here on. The sync
    // engine answers `offline` without asking the gateway while anything stays unsent, a region
    // that stopped syncing included; what is unsent is then weighed here.
    const ended = ResultAsync.fromSafePromise(leadership?.takeOver() ?? Promise.resolve())
      .andThen(() =>
        ResultAsync.fromSafePromise(space.sync?.signOut() ?? Promise.resolve('offline' as const)),
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

      if (this.#open === open) {
        open.space.resumeSync()
      }
    }

    return ended.andTee(release).orTee(release)
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

    const current = this.#open === open
    const tell = () => current && this.#emit(undefined)

    if (current) {
      this.#open = undefined
      open.status.live = false
      this.#options.onSyncState(NOT_SYNCING)
    }

    const deleted = this.#deletion
      .destroy(open.space)
      .map((outcome) => this.#noticeIf(outcome))
      .andTee(tell)
      .orTee(tell)

    this.#retire(Promise.resolve(deleted).then(() => undefined))

    return deleted
  }

  /** A delete another tab holds up leaves the sign-in page a word: the data goes once that tab closes. */
  #noticeIf(outcome: DeleteOutcome): void {
    if (outcome === 'pending') {
      saveNotice(this.#options.storage, 'delete-pending')
    }
  }

  #transportContext(identity: IdentityId): TransportContext {
    return sessionTransportContext(identity, this.#options.storage, {
      renewed: () => this.#organisations.renewed(),
      memberships: (memberships) => {
        if (this.#open?.space.identity.id === identity) {
          void this.#organisations.apply(memberships)
        }
      },
      refused: () => {
        this.#channelEnded(identity)
        void this.#forced(() => this.#refused(identity))
      },
      revoked: () => void this.#outElsewhere(identity),
    })
  }

  /** The channel of `identity`, open on this tab, ended for good: its keys are renewed no more. */
  #channelEnded(identity: IdentityId): void {
    if (this.#open?.space.identity.id === identity) {
      this.#organisations.ended()
    }
  }

  /**
   * Signed out from another device (4001), or everywhere at this device's request: as refused
   * keys, and the sign-in page says why. Whichever of the two runs second changes nothing, and
   * so does one whose session is no longer open (`still`) when its turn comes.
   */
  #outElsewhere(identity: IdentityId, still = () => true): Promise<void> {
    this.#channelEnded(identity)

    return this.#forced(() =>
      still() ? this.#refused(identity, 'signed-out-elsewhere') : okAsync(undefined),
    )
  }

  /**
   * Runs a sign-out the gateway forced on the device, once the transitions before it ended; a
   * failure is reported. Resolves once it ran.
   */
  #forced(run: () => ResultAsync<void, DataError>): Promise<void> {
    return this.#closed
      ? Promise.resolve()
      : this.#serially(run).match(
          () => undefined,
          (error) => this.#options.onError(error),
        )
  }

  /**
   * The gateway refused the identity's keys, which will not work again, or signed the device
   * out from another one: the device signs out here, without the gateway, behind the same write
   * barrier as a sign-out, and leaves nothing to revoke. Its data for the identity goes with the
   * keys only when nothing in it waits to be sent, and the sign-in page then says `notice`, if
   * any; otherwise (or when that cannot be read) the database stays, and the sign-in page says
   * that signing in again as the identity sends the changes.
   */
  #refused(identity: IdentityId, notice?: 'signed-out-elsewhere'): ResultAsync<void, DataError> {
    const open = this.#open
    const storage = this.#options.storage

    if (open?.space.identity.id !== identity) {
      return okAsync(undefined)
    }

    // Another tab changed who is signed in: what happens to this identity's data is its call.
    if (savedIdentity(storage)?.id !== identity) {
      this.#leaveAndTell()

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

  /** Whether the space holds changes not sent yet; an outbox that cannot be read is reported and counts. */
  #unsentOrUnknown(open: OpenSpace): ResultAsync<boolean, DataError> {
    return open.space.unsent().orElse((error) => {
      this.#options.onError(error)

      return okAsync(true)
    })
  }

  /**
   * Forgets the keys, leaving live ones to revoke, and closes the space, keeping its database
   * with the changes it holds: the sign-in page says that signing in again as the identity
   * sends them.
   */
  #keepForNextSignIn(open: OpenSpace, keys: KeysLeft): void {
    saveNotice(this.#options.storage, 'resend-after-sign-in')
    this.#pendingRevoke.forgetKeys(keys)

    if (this.#open === open) {
      this.#leaveAndTell()
    }
  }

  /** Another tab changed the saved identity: this tab follows, closing a space that is no longer it. */
  #followElsewhere(): void {
    if (this.#closed) {
      return
    }

    void this.#serially(() => {
      const open = this.#open

      if (open && savedIdentity(this.#options.storage)?.id !== open.space.identity.id) {
        this.#leaveAndTell()
      }

      return okAsync(undefined)
    }).match(
      () => undefined,
      (error) => this.#options.onError(error),
    )
  }

  /** Closes the open space, if any, and tells the subscribers that nobody is signed in. */
  #leaveAndTell(): void {
    const open = this.#open

    if (!open) {
      return
    }

    this.#open = undefined
    open.status.live = false
    this.#options.onSyncState(NOT_SYNCING)
    this.#retire(open.space.close())
    this.#emit(undefined)
  }

  /** Work that outlives the space it ends; `close` waits for it. */
  #retire(work: Promise<void>): void {
    this.#retiring = Promise.all([this.#retiring, work.catch(() => undefined)])
  }

  #emit(user: AuthUser | undefined): void {
    for (const listener of this.#listeners) {
      listener(user)
    }

    this.#organisations.tell()
  }
}
