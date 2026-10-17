import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow'

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
import type {
  DeviceCredentials,
  EndReason,
  Leadership,
  SyncHints,
  SyncTransport,
} from '@workspace/replica/sync'

import type { SessionPort, SignOutOptions } from '../platform/session.port'

import { CurrentSpaceRunner, CurrentSpaceWritePath, type SpaceSource } from './current-space'
import type { GatewayAuth, SignedInDevice } from './gateway-auth'
import {
  type IdentitySpace,
  openIdentitySpace,
  type SyncState,
  type Visibility,
} from './identity-space'
import {
  forgetDevice,
  IDENTITY_KEY,
  type KeyValueStorage,
  saveDevice,
  savedIdentity,
  savedKeys,
  saveKeys,
} from './storage'

/** What the channel of one identity needs: its keys, a place for renewed ones, word that it ended. */
export interface TransportContext {
  readonly identity: IdentityId
  readonly credentials: () => DeviceCredentials | undefined
  readonly onTokens: (tokens: SignedInDevice['tokens']) => void
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
  readonly schema: ReplicaSchema
  readonly transport: (context: TransportContext) => SyncTransport
  /** The Web Lock that makes one tab per browser the identity's sync leader; undefined without Web Locks. */
  readonly leadership: (identity: IdentityId) => Leadership | undefined
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

interface OpenSpace {
  readonly space: IdentitySpace
  readonly leadership: Leadership | undefined
  readonly status: SpaceStatus
}

type SignOutOutcome = 'signed-out' | 'needs-confirmation'

const NOT_SYNCING: SyncState = { leader: false, channel: 'down' }

const closedDuringSignIn = () =>
  dataError('data:AUTH_FAILED', 'the session was closed during this sign-in')

/**
 * The signed-in identity and its space. Signing up or in goes through the gateway, keeps the
 * identity and its keys in the browser's storage and opens the identity's space; restoring
 * opens the saved identity's space without the network. Signing out drains and has the
 * gateway sign the device out, then forgets the keys and deletes the identity's database;
 * with changes that cannot be sent it asks first. The tabs of a browser follow the saved
 * identity: when another tab signs it out, this one closes its space.
 */
export class SessionService implements SessionPort {
  readonly runner: CurrentSpaceRunner
  readonly writePath: CurrentSpaceWritePath
  readonly #options: SessionOptions
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  readonly #unlisten: Array<() => void>
  #open: OpenSpace | undefined
  #generation = 0
  #transitions: Promise<unknown> = Promise.resolve()
  #closed = false
  #retiring: Promise<unknown> = Promise.resolve()

  constructor(options: SessionOptions) {
    this.#options = options

    const spaces: SpaceSource = {
      current: () => this.#open?.space,
      onSwitch: (listener) => this.subscribe(() => listener()),
    }

    this.runner = new CurrentSpaceRunner(spaces)
    this.writePath = new CurrentSpaceWritePath(spaces)
    this.#unlisten = [
      options.storage.onChangeElsewhere((key) => {
        if (key === undefined || key === IDENTITY_KEY) {
          this.#followElsewhere()
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
    const leadership = this.#options.leadership(identity.id)

    return openIdentitySpace({
      identity,
      openLocal: this.#options.openLocal,
      schema: this.#options.schema,
      transport: () => this.#options.transport(this.#transportContext(identity.id)),
      leadership,
      hints: this.#options.hints(identity.id),
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

        this.#open = { space, leadership, status }
        space.visibility(this.#options.visibility.current())
        this.#options.onStep?.('ready')
        this.#emit(identity)

        return ok(identity)
      })
  }

  #signOut(forgetUnsent: boolean): ResultAsync<SignOutOutcome, DataError> {
    const open = this.#open

    if (!open) {
      forgetDevice(this.#options.storage)

      return okAsync('signed-out')
    }

    const { space, leadership } = open

    // The sign-out runs where the person asked for it: this tab leads from here on. The sync
    // engine answers `offline` without asking the gateway while anything stays unsent, a region
    // that stopped syncing included; what is unsent is then weighed here.
    return ResultAsync.fromSafePromise(leadership?.takeOver() ?? Promise.resolve())
      .andThen(() =>
        ResultAsync.fromSafePromise(space.sync?.signOut() ?? Promise.resolve('offline' as const)),
      )
      .andThen((outcome) =>
        outcome === 'signed-out' || forgetUnsent ? okAsync(false) : space.unsent(),
      )
      .andThen((asks) =>
        asks
          ? okAsync<SignOutOutcome>('needs-confirmation')
          : this.#forgetSpace(open).map((): SignOutOutcome => 'signed-out'),
      )
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
        }
      },
      // A sign-out this device asked for is heard by `signOut`, through the sync engine.
      onEnded: (reason) => {
        if (reason === 'unauthorized' && !this.#closed) {
          void this.#serially(() => this.#refused(identity)).match(
            () => undefined,
            (error) => this.#options.onError(error),
          )
        }
      },
    }
  }

  /**
   * The gateway refused the identity's keys, which will not work again: the device signs out
   * here, without the gateway, and its data for the identity goes with the keys.
   */
  #refused(identity: IdentityId): ResultAsync<void, DataError> {
    const open = this.#open

    if (open?.space.identity.id !== identity) {
      return okAsync(undefined)
    }

    // Another tab changed who is signed in: what happens to this identity's data is its call.
    if (savedIdentity(this.#options.storage)?.id !== identity) {
      this.#leaveAndTell()

      return okAsync(undefined)
    }

    return this.#forgetSpace(open)
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
  }
}
