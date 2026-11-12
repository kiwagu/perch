/**
 * What reaches the session from elsewhere: the channel of its space (memberships, the account's
 * platform roles, a session token the gateway refuses, a sign-out from another device or
 * everywhere, or by a ban of the account) and the other tabs of the browser (a sign-in or a
 * sign-out made there).
 */

import { okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { type KeptSession, savedSession, savedSignIn } from '../storage'

import type { SessionHost } from './host'
import type { TransportContext } from './options'
import type { SessionOrganisations } from './organisations'
import type { SessionRoles } from './roles'
import type { SessionSignIn } from './sign-in'
import type { ElsewhereNotice, ForcedSignOut, SessionSignOut } from './sign-out'
import { sessionTransportContext } from './transport-context'

export interface SessionElsewhereOptions {
  readonly host: SessionHost
  readonly organisations: SessionOrganisations
  readonly roles: SessionRoles
  readonly signingIn: SessionSignIn
  readonly signingOut: SessionSignOut
}

export class SessionElsewhere {
  readonly #host: SessionHost
  readonly #organisations: SessionOrganisations
  readonly #roles: SessionRoles
  readonly #signingIn: SessionSignIn
  readonly #signingOut: SessionSignOut
  #protocolRefused = false

  constructor(options: SessionElsewhereOptions) {
    this.#host = options.host
    this.#organisations = options.organisations
    this.#roles = options.roles
    this.#signingIn = options.signingIn
    this.#signingOut = options.signingOut
  }

  /** Names the session open now; see `SessionService.signingOutEverywhere`. */
  signingOutEverywhere(): () => ResultAsync<void, DataError> {
    const asking = this.#host.open()
    const still = () => asking !== undefined && this.#host.open() === asking

    return () =>
      ResultAsync.fromSafePromise(
        asking && still() ? this.#outElsewhere(() => asking.signIn, still) : Promise.resolve(),
      )
  }

  /**
   * The gateway deleted the account `identity` and ended its sessions: this device signs out of it
   * as when its channel hears the 4001 (the sign-in page says `signed-out-elsewhere`), which it
   * may never hear (no Web Locks, or its WebSocket blocked). Only the session open for `identity`
   * is signed out, judged in the turn the sign-out takes: another account's stays, nobody's
   * changes nothing, and so does a session the 4001 already ended. Resolves once it ran.
   */
  accountDeleted(identity: IdentityId): Promise<void> {
    return this.#outElsewhere(() => {
      const open = this.#host.open()

      return open?.signIn.identity === identity ? open.signIn : undefined
    })
  }

  /**
   * Names the session open now, for a reset of a password asked with its `token`: the sign-out it
   * gives runs as when the channel hears the 4002 (the sign-in page says
   * `password-changed-elsewhere`), which this device may never hear (no Web Locks, or its
   * WebSocket blocked), and only while that session is still the one open and the browser still
   * keeps that token: a sign-in made since, in this tab or another one that saved its new token
   * for the same account, stays. Undefined with nobody signed in.
   */
  resetHere(token: string): (() => Promise<void>) | undefined {
    const asking = this.#host.open()

    if (asking === undefined) {
      return undefined
    }

    const still = () =>
      this.#host.open() === asking && savedSession(this.#host.options.storage)?.token === token

    return () => this.#outElsewhere(() => asking.signIn, still, 'password-changed-elsewhere')
  }

  /** Whether a channel of this page heard the gateway refuse the build's protocol; see `SessionPort`. */
  protocolRefused(): boolean {
    return this.#protocolRefused
  }

  /**
   * The context of the channel of the space of the sign-in `session`: what it hears acts for that
   * sign-in alone, while its space is the one open here, and the endings it hears end that one.
   */
  transportContext(session: KeptSession): TransportContext {
    const identity = session.identity
    const ofSession = () => session
    const isOpen = () => this.#host.open()?.signIn.signIn === session.signIn

    return sessionTransportContext(session, this.#host.options.storage, {
      memberships: (memberships) => {
        if (isOpen()) {
          void this.#organisations.apply(memberships)
        }
      },
      // Kept for the identity whose space is open here, as its memberships are; the roles judge
      // again that it is still the one signed in on the browser.
      roles: (roles) => {
        if (isOpen()) {
          this.#roles.apply(session, roles)
        }
      },
      refused: () =>
        void this.#forced(() => this.#signingOut.refused(session).map(this.#followIfSignedIn)),
      revoked: () => void this.#outElsewhere(ofSession),
      passwordChanged: () =>
        void this.#outElsewhere(ofSession, undefined, 'password-changed-elsewhere'),
      deviceLimit: () => void this.#outElsewhere(ofSession, undefined, 'device-limit-elsewhere'),
      banned: () => void this.#outElsewhere(ofSession, undefined, 'account-banned'),
      // The build is what the gateway refuses, whichever account's channel heard it, and while
      // its space still opens too: kept for the frame that listens later, and published.
      protocolRefused: () => {
        this.#protocolRefused = true
        this.#host.options.publish({
          name: 'sync.protocol-refused',
          payload: null,
          actorId: identity,
          occurredAt: new Date(),
        })
      },
    })
  }

  /**
   * Another tab changed the saved sign-in: this tab follows, closing a space that is no longer
   * the current sign-in's (another account's, or an earlier sign-in of the same one) and, with
   * none open, opening the space of the sign-in another tab saved. An identity this tab shows
   * without its space leaves at once, not behind the start's open, so nothing more is asked or
   * shown in its name meanwhile.
   */
  follow(): void {
    if (this.#host.isClosed()) {
      return
    }

    this.#host.leaveUnopened()

    void this.#host
      .serially((generation) => {
        const open = this.#host.open()
        const saved = savedSignIn(this.#host.options.storage)

        if (open && saved?.session.signIn !== open.signIn.signIn) {
          this.#host.leaveAndTell()
        }

        // One account per browser: a tab with nobody signed in follows a sign-in made elsewhere.
        return saved && !this.#host.open()
          ? this.#signingIn.openSpace(saved, generation).map(() => undefined)
          : okAsync(undefined)
      })
      .match(
        () => undefined,
        (error) => this.#host.options.onError(error),
      )
  }

  /**
   * Signed out from another device (4001), everywhere at this device's request, by a change of
   * the account's password (4002), by a sign-in past the account's limit of devices (4003), or by
   * an operator's ban of the account (4004), whose `notice` says so: as a refused token, and the
   * sign-in page says why. It ends the sign-in `ended` names in its turn, if any. Whichever of two
   * runs second changes nothing, and so does one whose session is no longer open (`still`) when
   * its turn comes.
   */
  #outElsewhere(
    ended: () => KeptSession | undefined,
    still = () => true,
    notice: ElsewhereNotice = 'signed-out-elsewhere',
  ): Promise<void> {
    return this.#forced(() => {
      const session = still() ? ended() : undefined

      return session
        ? this.#signingOut.refused(session, notice).map(this.#followIfSignedIn)
        : okAsync(undefined)
    })
  }

  /**
   * A forced sign-out another tab's sign-in overtook left this tab with no space: it follows what
   * that tab saved, as on any sign-in made there (`follow`), in a turn of its own.
   */
  readonly #followIfSignedIn = (ended: ForcedSignOut): void => {
    if (ended === 'signed-in-since') {
      this.follow()
    }
  }

  /**
   * Runs a sign-out the gateway forced on the device, once the transitions before it ended; a
   * failure is reported. Resolves once it ran.
   */
  #forced(run: () => ResultAsync<void, DataError>): Promise<void> {
    return this.#host.isClosed()
      ? Promise.resolve()
      : this.#host.serially(run).match(
          () => undefined,
          (error) => this.#host.options.onError(error),
        )
  }
}
