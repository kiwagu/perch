import { okAsync, ResultAsync } from 'neverthrow'

import type { AuthUser, DataError, SignInInput, SignUpInput } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import type {
  EmailVerified,
  SessionNotice,
  SessionPort,
  SignOutOptions,
} from '../../platform/session.port'
import { CurrentSpaceRunner, CurrentSpaceWritePath, type SpaceSource } from '../current-space'
import type { IdentitySpace, SyncState } from '../identity-space'
import { forgetNotice, IDENTITY_KEY, MEMBERSHIPS_KEY, savedIdentity, savedNotice } from '../storage'

import { SessionElsewhere } from './elsewhere'
import type { SessionHost } from './host'
import type { OpenSpace } from './open-space'
import type { SessionOptions } from './options'
import { SessionOrganisations } from './organisations'
import { PendingRevoke } from './pending-revoke'
import { SessionSignIn } from './sign-in'
import { SessionSignOut, type SignOutOutcome } from './sign-out'
import { SpaceDeletion } from './space-deletion'
import { SessionTransitions } from './transitions'
import { verifyEmail } from './verification'
import { WriteBarrier } from './write-barrier'

const NOT_SYNCING: SyncState = { leader: false, channel: 'down' }

/** The saved identity while the start opens its space, and the end of that open. */
interface Opening {
  readonly user: AuthUser
  readonly settled: Promise<unknown>
}

/**
 * The signed-in identity and its space. Signing up or in goes through the gateway, naming the
 * device (its id and label), keeps the identity and its session token in the browser's storage
 * and opens the identity's space; restoring opens the saved identity's space without the network.
 * Signing out drains and has the gateway sign the device out, then forgets the token and
 * deletes the identity's databases, its own and every organisation database the device holds
 * for it; with changes that cannot be sent it asks first. A sign-out the gateway did not
 * confirm leaves the token to sign out once online (`PendingRevoke`). A token the gateway
 * refuses, or a sign-out from another device, sign the device out without it; the database goes too
 * unless it holds changes not sent yet, which wait for the next sign-in as the identity. One
 * account per browser: the tabs follow the saved identity, and a sign-in finding another account
 * saved is refused. While a sign-out runs, no tab of the browser takes a write: a write landing
 * after the final drain would go with the database. While the start opens the saved identity's
 * space, that identity is the current one, and what is read or written waits for the space.
 */
export class SessionService implements SessionPort {
  readonly runner: CurrentSpaceRunner
  readonly writePath: CurrentSpaceWritePath
  readonly #options: SessionOptions
  readonly #listeners = new Set<(user: AuthUser | undefined) => void>()
  readonly #organisations: SessionOrganisations
  readonly #signingIn: SessionSignIn
  readonly #signingOut: SessionSignOut
  readonly #elsewhere: SessionElsewhere
  readonly #unlisten: Array<() => void>
  readonly #transitions = new SessionTransitions()
  #open: OpenSpace | undefined
  #opening: Opening | undefined
  #retiring: Promise<unknown> = Promise.resolve()

  constructor(options: SessionOptions) {
    this.#options = options
    this.#organisations = new SessionOrganisations({
      storage: options.storage,
      open: () => this.#open,
    })

    const barrier = new WriteBarrier({
      locks: options.locks,
      clock: options.clock,
      storage: options.storage,
      onError: options.onError,
    })
    const pendingRevoke = new PendingRevoke({
      auth: options.auth,
      storage: options.storage,
      online: options.online,
      onError: options.onError,
    })
    const deletion = new SpaceDeletion({
      storage: options.storage,
      clock: options.clock,
      locks: options.locks,
      deleteLocal: options.deleteLocal,
      deleteTenantLocal: options.deleteTenantLocal,
      inventory: (identity) => this.#organisations.databases(identity),
      onError: options.onError,
    })
    const host: SessionHost = {
      options,
      open: () => this.#open,
      opened: (open) => {
        this.#open = open
      },
      drop: (open) => this.#drop(open),
      generation: () => this.#transitions.generation(),
      isClosed: () => this.#transitions.isClosed(),
      serially: (run) => this.#transitions.serially(run),
      leaveAndTell: () => this.#leaveAndTell(),
      retire: (work) => this.#retire(work),
      emit: (user) => this.#emit(user),
    }

    this.#signingOut = new SessionSignOut({ host, barrier, pendingRevoke, deletion })
    this.#signingIn = new SessionSignIn({
      host,
      organisations: this.#organisations,
      barrier,
      pendingRevoke,
      deletion,
      transportContext: (identity) => this.#elsewhere.transportContext(identity),
    })
    this.#elsewhere = new SessionElsewhere({
      host,
      organisations: this.#organisations,
      signingIn: this.#signingIn,
      signingOut: this.#signingOut,
    })

    const spaces: SpaceSource = {
      current: () => this.#open?.space,
      onSwitch: (listener) => this.subscribe(() => listener()),
      opening: () => this.#opening?.settled,
      signingOut: () => barrier.signingOut(this.#open?.heard),
      writing: (space, work) => barrier.writing(space.identity.id, work),
    }

    this.runner = new CurrentSpaceRunner(spaces)
    this.writePath = new CurrentSpaceWritePath(spaces)
    this.#unlisten = [
      options.storage.onChangeElsewhere((key) => {
        if (key === undefined || key === IDENTITY_KEY) {
          this.#elsewhere.follow()
        } else if (key === MEMBERSHIPS_KEY) {
          this.#organisations.followSaved()
        }
      }),
      options.visibility.onChange((state) => this.#open?.space.visibility(state)),
    ]
  }

  current(): AuthUser | undefined {
    return this.#open?.space.identity ?? this.#opening?.user
  }

  space(): IdentitySpace | undefined {
    return this.#open?.space
  }

  subscribe(listener: (user: AuthUser | undefined) => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  signUp(input: SignUpInput): ResultAsync<AuthUser, DataError> {
    return this.#transitions.serially((generation) => this.#signingIn.signUp(input, generation))
  }

  signIn(input: SignInInput): ResultAsync<AuthUser, DataError> {
    return this.#transitions.serially((generation) => this.#signingIn.signIn(input, generation))
  }

  verifyEmail(token: string): ResultAsync<EmailVerified, DataError> {
    return this.#transitions.serially((generation) =>
      verifyEmail(this.#signingIn, this.#options.auth, token, generation),
    )
  }

  resendVerification(email: string): ResultAsync<void, DataError> {
    return this.#options.auth.resendVerification(email)
  }

  signOut(options: SignOutOptions = {}): ResultAsync<SignOutOutcome, DataError> {
    return this.#transitions.serially(() => this.#signingOut.signOut(options.forgetUnsent ?? false))
  }

  /**
   * Names the session open now, before it asks the gateway to sign every device of the identity
   * out; what it returns signs that session out once the gateway did, as on the channel's 4001,
   * which it may never hear (no Web Locks, or its WebSocket blocked). A late answer finds the
   * session ended (the 4001 came first) and changes nothing, whoever signed in since. Asked while
   * the start opens the saved identity's space, it names the session that open makes, once made:
   * none when it did not open or another identity's space opened instead.
   */
  signingOutEverywhere(): () => ResultAsync<void, DataError> {
    const opening = this.#opening

    if (!opening) {
      return this.#elsewhere.signingOutEverywhere()
    }

    const naming = opening.settled.then(() =>
      this.#openFor(opening) ? this.#elsewhere.signingOutEverywhere() : undefined,
    )

    return () =>
      ResultAsync.fromSafePromise(naming).andThen((signOut) => signOut?.() ?? okAsync(undefined))
  }

  /**
   * Opens the space of the identity saved by an earlier sign-in; the network is not needed.
   * Online, a token a sign-out left to sign out is sent meanwhile. Until the space is open (or did
   * not open), the saved identity is the current one and reads and writes wait for its space.
   */
  restore(): ResultAsync<AuthUser | undefined, DataError> {
    const saved = savedIdentity(this.#options.storage)
    const restoring = this.#transitions.serially((generation) =>
      this.#signingIn.restore(generation),
    )

    if (saved) {
      // The saved identity is current while its space opens, so the page renders for it at once.
      const opening: Opening = { user: saved, settled: Promise.resolve(restoring) }

      this.#opening = opening
      void opening.settled.then(() => this.#opened(opening))
    }

    return restoring
  }

  /**
   * The saved identity's space did not open: signs it out on this device without it. Its token
   * is left to sign out (sent at once online) and its databases deleted, its own and every
   * organisation one counted for it, with whatever they held that was not sent. Changes nothing
   * while a space is open or nobody is saved.
   */
  signOutUnopened(): ResultAsync<void, DataError> {
    return this.#transitions.serially(() => this.#signingOut.unopened())
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

  protocolRefused(): boolean {
    return this.#elsewhere.protocolRefused()
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

  /**
   * An organisation this device created joins the identity's memberships; see
   * `SessionOrganisations.adopt`. One created while the start opens the saved identity's space
   * joins once that space is open, and nobody else's.
   */
  adoptMembership(created: Membership): Promise<void> {
    const opening = this.#opening

    return opening
      ? opening.settled.then(() =>
          this.#openFor(opening) ? this.#organisations.adopt(created) : undefined,
        )
      : this.#organisations.adopt(created)
  }

  /**
   * Closes the space, keeping the saved token, and resolves once its last writes are persisted
   * and projected and its database is closed (or deleted, by a sign-out under way).
   */
  async close(): Promise<void> {
    this.#transitions.close()

    for (const stop of this.#unlisten.splice(0)) {
      stop()
    }

    this.#leaveAndTell()
    await this.#retiring
  }

  /** Whether the space open now is the one the start's `opening` opened. */
  #openFor(opening: Opening): boolean {
    return this.#open?.space.identity.id === opening.user.id
  }

  /** The start's open of the saved identity's space ended, opened or not. */
  #opened(opening: Opening): void {
    if (this.#opening === opening) {
      this.#opening = undefined
    }
  }

  /** `open` is no longer the session's space: nobody is current, and its sync state is reported no more. */
  #drop(open: OpenSpace): void {
    this.#open = undefined
    open.status.live = false
    this.#options.onSyncState(NOT_SYNCING)
  }

  /** Closes the open space, if any, and tells the subscribers that nobody is signed in. */
  #leaveAndTell(): void {
    const open = this.#open

    if (!open) {
      return
    }

    this.#drop(open)
    this.#retire(open.space.close())
    this.#emit(undefined)
  }

  /** Work that outlives the space it ends; `close` waits for it. */
  #retire(work: Promise<void>): void {
    this.#retiring = Promise.all([this.#retiring, work.catch(() => undefined)])
  }

  #emit(user: AuthUser | undefined): void {
    // Nobody is signed in any more: neither is the identity whose space the start was opening.
    if (user === undefined) {
      this.#opening = undefined
    }

    for (const listener of this.#listeners) {
      listener(user)
    }

    this.#organisations.tell()
  }
}
