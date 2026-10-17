import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { match, P } from 'ts-pattern'

import {
  type AuthUser,
  type DataError,
  dataError,
  type LocalDb,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import type { Membership } from '@workspace/replica/protocol'
import {
  type DeviceCredentials,
  type EndReason,
  type Leadership,
  type LockManagerLike,
  leadership,
  lockName,
  type SyncHint,
  type SyncHints,
  type SyncTransport,
  writeLockName,
} from '@workspace/replica/sync'

import type { SessionNotice, SessionPort, SignOutOptions } from '../platform/session.port'

import { CurrentSpaceRunner, CurrentSpaceWritePath, type SpaceSource } from './current-space'
import type { GatewayAuth, SignedInDevice } from './gateway-auth'
import {
  type IdentitySpace,
  openIdentitySpace,
  type SyncState,
  type Visibility,
} from './identity-space'
import { SessionOrganisations } from './organisations'
import {
  forgetDevice,
  forgetNotice,
  forgetSigningOut,
  IDENTITY_KEY,
  type KeyValueStorage,
  MEMBERSHIPS_KEY,
  saveDevice,
  savedIdentity,
  savedKeys,
  savedNotice,
  saveKeys,
  saveNotice,
  saveSigningOut,
  signingOutSince,
} from './storage'

/** What the channel of one identity needs: its keys, where renewed keys and memberships go, its end. */
export interface TransportContext {
  readonly identity: IdentityId
  readonly credentials: () => DeviceCredentials | undefined
  readonly onTokens: (tokens: SignedInDevice['tokens']) => void
  readonly onMemberships: (memberships: readonly Membership[]) => void
  readonly onEnded: (reason: EndReason) => void
}

/** Whether the tab is in the foreground, and how to hear that it changed. */
export interface VisibilitySource {
  current(): Visibility
  onChange(listener: (state: Visibility) => void): () => void
}

export interface SessionOptions {
  readonly auth: GatewayAuth
  readonly openLocal: (identity: IdentityId) => ResultAsync<LocalDb, DataError>
  /** Opens the database of one organisation of an identity: each has its own on the device. */
  readonly openTenantLocal: (identity: IdentityId, key: string) => ResultAsync<LocalDb, DataError>
  /** Deletes the database of one organisation of an identity while it is not open. */
  readonly deleteTenantLocal: (identity: IdentityId, key: string) => ResultAsync<void, DataError>
  readonly schema: ReplicaSchema
  readonly transport: (context: TransportContext) => SyncTransport
  /**
   * The browser's Web Locks: one makes one tab per browser the identity's sync leader, another
   * lets a sign-out wait for the writes every tab admitted. Undefined without Web Locks: such a
   * browser does not sync, and its sign-out waits for no other tab.
   */
  readonly locks: LockManagerLike | undefined
  readonly hints: (identity: IdentityId) => SyncHints
  readonly clock: Clock
  readonly storage: KeyValueStorage
  readonly visibility: VisibilitySource
  /** An identity's space starts to open (`open-db`) or is open (`ready`). */
  readonly onStep?: (step: 'open-db' | 'ready') => void
  readonly onSyncState: (state: SyncState) => void
  readonly onError: (error: DataError) => void
}

/** Whether an open space still speaks for the tab: a space being closed reports nothing more. */
interface SpaceStatus {
  live: boolean
}

/** When this tab heard another one begin a sign-out, until it hears the sign-out end. */
interface HeardSignOut {
  at: number | undefined
}

interface OpenSpace {
  readonly space: IdentitySpace
  readonly leadership: Leadership | undefined
  readonly status: SpaceStatus
  /** The hints between the tabs of the identity; the space closes them. */
  readonly hints: SyncHints
  readonly heard: HeardSignOut
}

type SignOutOutcome = 'signed-out' | 'needs-confirmation'

const NOT_SYNCING: SyncState = { leader: false, channel: 'down' }

/**
 * How long a sign-out holds every tab's writes back at most. A sign-out ends well within it (up
 * to 5 seconds for the channel, 10 for the drain and 10 for the gateway's close); a tab that
 * went away during its sign-out leaves the mark behind, and writes must not stay refused for good.
 */
const SIGN_OUT_BARRIER_MS = 60_000

/**
 * How long a sign-out waits for the writes other tabs admitted before its barrier went up. A
 * write is durable within moments; a tab that holds one longer is taken for frozen, and the
 * database is kept rather than deleted under it.
 */
const WRITERS_MS = 10_000

function isAbortError(cause: unknown): boolean {
  return cause instanceof Error && cause.name === 'AbortError'
}

const closedDuringSignIn = () =>
  dataError('data:AUTH_FAILED', 'the session was closed during this sign-in')

/**
 * The signed-in identity and its space. Signing up or in goes through the gateway, keeps the
 * identity and its keys in the browser's storage and opens the identity's space; restoring
 * opens the saved identity's space without the network. Signing out drains and has the
 * gateway sign the device out, then forgets the keys and deletes the identity's databases, its
 * own and every organisation database the device holds for it; with changes that cannot be
 * sent it asks first. Keys the gateway refuses sign the device
 * out without it; the database goes too unless it holds changes not sent yet, which wait for
 * the next sign-in as the identity. The tabs of a browser follow the saved identity: when
 * another tab signs it out, this one closes its space. While a sign-out runs, no tab of the
 * browser takes a write: a write landing after the final drain would go with the database.
 */
export class SessionService implements SessionPort {
  readonly runner: CurrentSpaceRunner
  readonly writePath: CurrentSpaceWritePath
  readonly #options: SessionOptions
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  readonly #organisations: SessionOrganisations
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

    const spaces: SpaceSource = {
      current: () => this.#open?.space,
      onSwitch: (listener) => this.subscribe(() => listener()),
      signingOut: () => this.#signingOut(),
      writing: (space, work) => this.#writing(space, work),
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
      this.#options.auth.signUp(input).andThen((device) => this.#enter(device, generation)),
    )
  }

  signIn(input: SignInInput): ResultAsync<AuthUser, DataError> {
    return this.#serially((generation) =>
      this.#options.auth.signIn(input).andThen((device) => this.#enter(device, generation)),
    )
  }

  signOut(options: SignOutOptions = {}): ResultAsync<SignOutOutcome, DataError> {
    return this.#serially(() => this.#signOut(options.forgetUnsent ?? false))
  }

  /** Opens the space of the identity saved by an earlier sign-in; the network is not needed. */
  restore(): ResultAsync<AuthUser | undefined, DataError> {
    return this.#serially((generation): ResultAsync<AuthUser | undefined, DataError> => {
      const storage = this.#options.storage
      const identity = savedIdentity(storage)

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

    const status: SpaceStatus = { live: true }
    const lead = leadership(this.#options.locks, lockName(identity.id))
    const hints = this.#options.hints(identity.id)
    const heard: HeardSignOut = { at: undefined }

    // Another tab's sign-out holds this tab's writes back until it ends; the space closes the hints.
    hints.on((hint) => this.#heardHint(heard, hint))

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
      onError: this.#options.onError,
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

    this.#holdWrites(open)

    // The sign-out runs where the person asked for it: this tab leads from here on. The sync
    // engine answers `offline` without asking the gateway while anything stays unsent, a region
    // that stopped syncing included; what is unsent is then weighed here.
    const ended = ResultAsync.fromSafePromise(leadership?.takeOver() ?? Promise.resolve())
      .andThen(() =>
        ResultAsync.fromSafePromise(space.sync?.signOut() ?? Promise.resolve('offline' as const)),
      )
      // What is unsent is read, and the database deleted, only once no tab writes any more.
      .andThen((outcome) =>
        this.#exclusively(
          open,
          () =>
            outcome === 'signed-out'
              ? this.#signedOut(open, forgetUnsent).map((): SignOutOutcome => 'signed-out')
              : this.#stillSignedIn(open, forgetUnsent),
          'signed-out',
        ),
      )

    const release = () => {
      this.#releaseWrites(open)

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
      return this.#forgetSpace(open)
    }

    return this.#unsentOrUnknown(open).andThen((unsent) =>
      unsent ? okAsync(this.#keepForNextSignIn(open)) : this.#forgetSpace(open),
    )
  }

  /**
   * The engine could not have the gateway sign the device out: offline, or with changes it
   * could not send. With such changes it asks first; without them the device signs out here.
   */
  #stillSignedIn(open: OpenSpace, forgetUnsent: boolean): ResultAsync<SignOutOutcome, DataError> {
    return (forgetUnsent ? okAsync(false) : open.space.unsent()).andThen((asks) =>
      asks
        ? okAsync<SignOutOutcome>('needs-confirmation')
        : this.#forgetSpace(open).map((): SignOutOutcome => 'signed-out'),
    )
  }

  /**
   * Runs a write while holding the identity's write lock shared, until its change is durable:
   * any number of writes run at once, and a sign-out waits for all of them.
   */
  #writing<T>(
    space: IdentitySpace,
    work: () => ResultAsync<T, DataError>,
  ): ResultAsync<T, DataError> {
    const locks = this.#options.locks

    if (!locks) {
      return work()
    }

    const written = new Promise<Result<T, DataError>>((resolve) => {
      locks
        .request(writeLockName(space.identity.id), { mode: 'shared' }, async () => {
          resolve(await work())
        })
        .catch((cause: unknown) => {
          resolve(
            err(
              dataError(
                'data:WRITE_FAILED',
                `could not take the write lock of ${space.identity.id}`,
                cause,
              ),
            ),
          )
        })
    })

    return new ResultAsync(written)
  }

  /**
   * Runs `work` holding the identity's write lock exclusive: every write a tab admitted before
   * the barrier went up has become durable, and none runs meanwhile. A lock that does not come
   * within 10 seconds (a frozen tab) deletes nothing: the keys are forgotten and the database
   * is kept for the next sign-in, as when the gateway refuses the keys; that ends as `kept`.
   */
  #exclusively<T>(
    open: OpenSpace,
    work: () => ResultAsync<T, DataError>,
    kept: T,
  ): ResultAsync<T, DataError> {
    const locks = this.#options.locks

    if (!locks) {
      return work()
    }

    const controller = new AbortController()
    const giveUp = this.#options.clock.schedule(WRITERS_MS, () => controller.abort())
    const ended = new Promise<Result<T, DataError>>((resolve) => {
      locks
        .request(
          writeLockName(open.space.identity.id),
          { mode: 'exclusive', signal: controller.signal },
          async () => {
            giveUp()
            resolve(await work())
          },
        )
        .catch((cause: unknown) => {
          giveUp()

          if (!isAbortError(cause)) {
            this.#options.onError(
              dataError(
                'data:WRITE_FAILED',
                `could not wait for the writes of every tab into ${open.space.identity.id}`,
                cause,
              ),
            )
          }

          this.#keepForNextSignIn(open)
          resolve(ok(kept))
        })
    })

    return new ResultAsync(ended)
  }

  /** Holds every tab's writes back: the other tabs hear of it now, a tab opened later reads it. */
  #holdWrites(open: OpenSpace): void {
    saveSigningOut(this.#options.storage, this.#options.clock.now())
    open.hints.post('sign-out')
  }

  /** The sign-out ended: every tab writes again, and the leader drains what waits. */
  #releaseWrites(open: OpenSpace): void {
    forgetSigningOut(this.#options.storage)
    open.hints.post('kick')
  }

  /** A sign-out began in this browser within the barrier's time and has not ended. */
  #signingOut(): boolean {
    const now = this.#options.clock.now()
    const began = [signingOutSince(this.#options.storage), this.#open?.heard.at]

    return began.some((at) => at !== undefined && now - at < SIGN_OUT_BARRIER_MS)
  }

  #heardHint(heard: HeardSignOut, hint: SyncHint): void {
    if (hint === 'sign-out') {
      heard.at = this.#options.clock.now()
    } else if (hint === 'kick') {
      heard.at = undefined
    }
  }

  /**
   * Forgets the device's identity and keys, then deletes the identity's database. The other
   * tabs hear the identity go and close their own spaces, which lets the store be deleted.
   */
  #forgetSpace(open: OpenSpace): ResultAsync<void, DataError> {
    forgetDevice(this.#options.storage)

    if (this.#open === open) {
      this.#open = undefined
      open.status.live = false
      this.#options.onSyncState(NOT_SYNCING)
      this.#emit(undefined)
    }

    const destroying = open.space.destroy()

    this.#retire(destroying)

    return ResultAsync.fromPromise(destroying, (cause) =>
      dataError(
        'data:WRITE_FAILED',
        `could not delete the local data of ${open.space.identity.id}`,
        cause,
      ),
    )
  }

  #transportContext(identity: IdentityId): TransportContext {
    const storage = this.#options.storage
    const saved = () => savedIdentity(storage)?.id === identity

    return {
      identity,
      // Keys saved for another identity are not this channel's to present.
      credentials: () => (saved() ? savedKeys(storage) : undefined),
      onTokens: (tokens) => {
        if (saved()) {
          saveKeys(storage, tokens)
          this.#organisations.renewed()
        }
      },
      onMemberships: (memberships) => {
        if (this.#open?.space.identity.id === identity) {
          void this.#organisations.apply(memberships)
        }
      },
      onEnded: (reason) =>
        match(reason)
          .with('unauthorized', () => {
            if (!this.#closed) {
              void this.#serially(() => this.#refused(identity)).match(
                () => undefined,
                (error) => this.#options.onError(error),
              )
            }
          })
          // A sign-out this device asked for is heard by `signOut`, through the sync engine; a
          // refused protocol stops the sync engine, which reports it, and changes nothing here.
          .with(P.union('signed-out', 'protocol'), () => {})
          .exhaustive(),
    }
  }

  /**
   * The gateway refused the identity's keys, which will not work again: the device signs out
   * here, without the gateway, behind the same write barrier as a sign-out. Its data for the
   * identity goes with the keys only when nothing in it waits to be sent; otherwise (or when
   * that cannot be read) the database stays, and the sign-in page says that signing in again
   * as the identity sends the changes.
   */
  #refused(identity: IdentityId): ResultAsync<void, DataError> {
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
    // database deleted once no tab writes any more.
    this.#holdWrites(open)

    const release = () => this.#releaseWrites(open)

    return this.#exclusively(
      open,
      () =>
        this.#unsentOrUnknown(open).andThen((unsent) =>
          unsent ? okAsync(this.#keepForNextSignIn(open)) : this.#forgetSpace(open),
        ),
      undefined,
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
   * Forgets the keys and closes the space, keeping its database with the changes it holds: the
   * sign-in page says that signing in again as the identity sends them.
   */
  #keepForNextSignIn(open: OpenSpace): void {
    saveNotice(this.#options.storage, 'resend-after-sign-in')
    forgetDevice(this.#options.storage)

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
