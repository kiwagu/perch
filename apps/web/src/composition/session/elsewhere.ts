/**
 * What reaches the session from elsewhere: the channel of its space (memberships, keys the
 * gateway refuses, a sign-out from another device or everywhere) and the other tabs of the
 * browser (a sign-in or a sign-out made there).
 */

import { okAsync, ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'

import { savedIdentity } from '../storage'

import type { SessionHost } from './host'
import type { TransportContext } from './options'
import type { SessionOrganisations } from './organisations'
import type { SessionSignIn } from './sign-in'
import type { SessionSignOut } from './sign-out'
import { sessionTransportContext } from './transport-context'

export interface SessionElsewhereOptions {
  readonly host: SessionHost
  readonly organisations: SessionOrganisations
  readonly signingIn: SessionSignIn
  readonly signingOut: SessionSignOut
}

export class SessionElsewhere {
  readonly #host: SessionHost
  readonly #organisations: SessionOrganisations
  readonly #signingIn: SessionSignIn
  readonly #signingOut: SessionSignOut
  #protocolRefused = false

  constructor(options: SessionElsewhereOptions) {
    this.#host = options.host
    this.#organisations = options.organisations
    this.#signingIn = options.signingIn
    this.#signingOut = options.signingOut
  }

  /** Names the session open now; see `SessionService.signingOutEverywhere`. */
  signingOutEverywhere(): () => ResultAsync<void, DataError> {
    const asking = this.#host.open()
    const still = () => asking !== undefined && this.#host.open() === asking

    return () =>
      ResultAsync.fromSafePromise(
        asking && still() ? this.#outElsewhere(asking.space.identity.id, still) : Promise.resolve(),
      )
  }

  /** Whether a channel of this page heard the gateway refuse the build's protocol; see `SessionPort`. */
  protocolRefused(): boolean {
    return this.#protocolRefused
  }

  transportContext(identity: IdentityId): TransportContext {
    return sessionTransportContext(identity, this.#host.options.storage, {
      renewal: this.#organisations,
      memberships: (memberships) => {
        if (this.#host.open()?.space.identity.id === identity) {
          void this.#organisations.apply(memberships)
        }
      },
      refused: () => {
        this.#channelEnded(identity)
        void this.#forced(() => this.#signingOut.refused(identity))
      },
      revoked: () => void this.#outElsewhere(identity),
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
   * Another tab changed the saved identity: this tab follows, closing a space that is no longer
   * it and, with none open, opening the space of the identity another tab signed in.
   */
  follow(): void {
    if (this.#host.isClosed()) {
      return
    }

    void this.#host
      .serially((generation) => {
        const open = this.#host.open()
        const saved = savedIdentity(this.#host.options.storage)

        if (open && saved?.id !== open.space.identity.id) {
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

  /** The channel of `identity`, open on this tab, ended for good: its keys are renewed no more. */
  #channelEnded(identity: IdentityId): void {
    if (this.#host.open()?.space.identity.id === identity) {
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
      still() ? this.#signingOut.refused(identity, 'signed-out-elsewhere') : okAsync(undefined),
    )
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
