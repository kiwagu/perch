import { errAsync, okAsync, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import type {
  EmailVerified,
  SessionNotice,
  SessionPort,
  SignOutOptions,
} from '../../platform/session.port'
import { CurrentSpaceRunner, CurrentSpaceWritePath, type SpaceSource } from '../current-space'
import type { AccountSession } from '../gateway-auth'
import type { IdentitySpace } from '../identity-space'
import {
  deviceIdFrom,
  forgetNotice,
  IDENTITY_KEY,
  MEMBERSHIPS_KEY,
  savedIdentity,
  savedNotice,
  savedToken,
} from '../storage'

import { SessionElsewhere } from './elsewhere'
import type { SessionOptions } from './options'
import { SessionOrganisations } from './organisations'
import { PendingRevoke } from './pending-revoke'
import { SessionSignIn } from './sign-in'
import { SessionSignOut, type SignOutOutcome } from './sign-out'
import { SpaceDeletion } from './space-deletion'
import { SessionState } from './state'
import { SessionTransitions } from './transitions'
import { verifyEmail } from './verification'
import { WriteBarrier } from './write-barrier'

/**
 * The signed-in identity and its space. Signing up asks the gateway to create the account and
 * mail its verification link, and signs nothing in. Signing in, or the first exchange of a
 * verification link, goes through the gateway, naming the device (its id and label), keeps the
 * identity and its session token in the browser's storage and opens the identity's space;
 * restoring opens the saved identity's space without the network.
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
  readonly #state: SessionState
  readonly #organisations: SessionOrganisations
  readonly #signingIn: SessionSignIn
  readonly #signingOut: SessionSignOut
  readonly #elsewhere: SessionElsewhere
  readonly #unlisten: Array<() => void>
  readonly #transitions = new SessionTransitions()

  constructor(options: SessionOptions) {
    this.#options = options
    // The organisations follow every change of identity, once the subscribers heard of it.
    this.#state = new SessionState(options, this.#transitions, () => this.#organisations.tell())
    this.#organisations = new SessionOrganisations({
      storage: options.storage,
      open: () => this.#state.open(),
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
    const host = this.#state

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
      current: () => this.#state.open()?.space,
      onSwitch: (listener) => this.subscribe(() => listener()),
      opening: () => this.#state.opening()?.settled,
      signingOut: () => barrier.signingOut(this.#state.open()?.heard),
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
      options.visibility.onChange((state) => this.#state.open()?.space.visibility(state)),
    ]
  }

  current(): AuthUser | undefined {
    return this.#state.current()
  }

  space(): IdentitySpace | undefined {
    return this.#state.open()?.space
  }

  subscribe(listener: (user: AuthUser | undefined) => void): () => void {
    return this.#state.subscribe(listener)
  }

  /** Asks the gateway alone: nothing is signed in, so the session does not change. */
  signUp(input: SignUpInput): ResultAsync<void, DataError> {
    return this.#options.auth.signUp(input)
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

  /** Asks the gateway alone: the reset signs nothing in or out. */
  requestPasswordReset(email: string): ResultAsync<void, DataError> {
    return this.#options.auth.requestPasswordReset(email)
  }

  /**
   * Asks the gateway alone: it signs nothing in, and a device of the account it signs out, this one
   * included, hears so on its channel (4002).
   */
  resetPassword(token: string, password: string): ResultAsync<void, DataError> {
    return this.#options.auth.resetPassword(token, password)
  }

  /** Asks the gateway with this device's session; the other devices hear their sign-out (4002). */
  changePassword(currentPassword: string, password: string): ResultAsync<void, DataError> {
    return this.#accountSession().andThen((session) =>
      this.#options.auth.changePassword({ currentPassword, password }, session),
    )
  }

  /** Asks the gateway with this device's session; nothing changes here until the link is opened. */
  changeEmail(email: string, password: string): ResultAsync<void, DataError> {
    return this.#accountSession().andThen((session) =>
      this.#options.auth.changeEmail({ email, password }, session),
    )
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
    const opening = this.#state.opening()

    if (!opening) {
      return this.#elsewhere.signingOutEverywhere()
    }

    const naming = opening.settled.then(() =>
      this.#state.openFor(opening) ? this.#elsewhere.signingOutEverywhere() : undefined,
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
      this.#state.startOpening(saved, restoring)
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
    return this.#state.open()?.space.flush() ?? okAsync(undefined)
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
    const opening = this.#state.opening()

    return opening
      ? opening.settled.then(() =>
          this.#state.openFor(opening) ? this.#organisations.adopt(created) : undefined,
        )
      : this.#organisations.adopt(created)
  }

  /** The session this device is signed in with, for a change of its account; none signed in fails. */
  #accountSession(): ResultAsync<AccountSession, DataError> {
    const token = savedToken(this.#options.storage)

    return token === undefined || this.#state.open() === undefined
      ? errAsync(dataError('data:AUTH_FAILED', 'nobody is signed in on this device'))
      : okAsync({ token, device: deviceIdFrom(this.#options.storage) })
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

    this.#state.leaveAndTell()
    await this.#state.retired()
  }
}
