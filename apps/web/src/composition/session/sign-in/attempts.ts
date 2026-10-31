/**
 * The attempts to sign this browser in: a sign-in or a verification link's exchange, one at a
 * time in the browser's sign-in lock, the device it signed in kept whole or let go of, and the
 * restore of the identity an earlier sign-in saved.
 */

import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow'

import { type AuthUser, type DataError, dataError, type SignInInput } from '@workspace/data'

import type { NamedDevice, SignedInDevice } from '../../gateway-auth'
import { deviceIdFrom, forgetDevice, IDENTITY_KEY, saveDevice, savedIdentity } from '../../storage'
import type { SessionHost } from '../host'
import { otherAccountSaved, otherAccountSignedIn, otherIdentitySaved } from '../one-account'
import type { PendingRevoke } from '../pending-revoke'
import type { SpaceDeletion } from '../space-deletion'

import { cleanUpSignIn } from './cleanup'
import { closedDuringSignIn } from './closed'
import { brokenSignIn, oneSignInAtATime } from './lock'
import { type OpenSpaceDeps, openSpaceOf } from './space'

/** The user a sign-in signed in: its `ask` always answers a device, so none is a failure. */
const signedInUser = (user: AuthUser | undefined): ResultAsync<AuthUser, DataError> =>
  user === undefined
    ? errAsync(dataError('data:AUTH_FAILED', 'the sign-in signed nothing in'))
    : okAsync(user)

export interface SessionSignInOptions extends OpenSpaceDeps {
  readonly pendingRevoke: PendingRevoke
  readonly deletion: SpaceDeletion
}

export class SessionSignIn {
  readonly #host: SessionHost
  readonly #spaces: OpenSpaceDeps
  readonly #pendingRevoke: PendingRevoke
  readonly #deletion: SpaceDeletion

  constructor(options: SessionSignInOptions) {
    this.#host = options.host
    this.#spaces = {
      host: options.host,
      organisations: options.organisations,
      barrier: options.barrier,
      transportContext: options.transportContext,
    }
    this.#pendingRevoke = options.pendingRevoke
    this.#deletion = options.deletion
  }

  signIn(input: SignInInput, generation: number): ResultAsync<AuthUser, DataError> {
    return this.enter(
      input.email,
      (device) => this.#host.options.auth.signIn(input, device),
      generation,
    ).andThen(signedInUser)
  }

  /** Opens the saved identity's space, if any; see `SessionService.restore`. */
  restore(generation: number): ResultAsync<AuthUser | undefined, DataError> {
    const storage = this.#host.options.storage
    const identity = savedIdentity(storage)

    if (this.#host.options.online()) {
      void this.#pendingRevoke.send()
    }

    // What sign-outs left behind goes meanwhile: the databases of anyone but `identity`.
    void this.#deletion.deleteLeftovers()

    if (identity) {
      return this.openSpace(identity, generation)
    }

    // A kept value that names nobody is not a session.
    if (storage.get(IDENTITY_KEY) !== undefined) {
      forgetDevice(storage)
    }

    return okAsync(undefined)
  }

  openSpace(identity: AuthUser, generation: number): ResultAsync<AuthUser, DataError> {
    // The previous identity leaves with its space: nobody is current until the new one is open.
    this.#host.leaveAndTell()
    this.#host.options.onStep?.('open-db')

    // A delete of the identity's databases under way in any tab ends first; none starts meanwhile.
    return this.#deletion.open(identity.id, () => openSpaceOf(this.#spaces, identity, generation))
  }

  /** This browser as a sign-in or a verification names it. */
  #device(): NamedDevice {
    return { id: deviceIdFrom(this.#host.options.storage), label: this.#host.options.deviceLabel }
  }

  /**
   * Signs this browser in through `ask`, which names the device to the gateway (a sign-in, a
   * verification link's exchange). One account per browser: with the `email` of the
   * account asked for, it is refused at once while another account is signed in on this browser,
   * before the gateway is asked; without one (a link names no email), only once the answer came,
   * as is any sign-in that finds another account saved by then. The tokens sign-outs left are
   * signed out first: the sign-in replaces the device's session at the gateway, which a token left
   * after it would no longer name. An `ask` answering `undefined` signed nothing in: nothing is
   * kept, nothing opens, and it answers `undefined`.
   */
  enter(
    email: string | undefined,
    ask: (device: NamedDevice) => ResultAsync<SignedInDevice | undefined, DataError>,
    generation: number,
  ): ResultAsync<AuthUser | undefined, DataError> {
    const named = this.#device()

    // The browser's tabs sign in one at a time, from the request to the saved device; the space
    // opens once the lock is let go.
    return oneSignInAtATime(this.#host.options.locks, () => {
      // A session closed while the lock was awaited asks the gateway nothing.
      if (generation !== this.#host.generation()) {
        return errAsync(closedDuringSignIn())
      }

      const ready: ResultAsync<void, DataError> =
        email !== undefined && otherAccountSaved(this.#host.options.storage, email)
          ? errAsync(otherAccountSignedIn())
          : ResultAsync.fromSafePromise(this.#pendingRevoke.send())

      return ready
        .andThen(() => ask(named))
        .andThen((device) =>
          device === undefined ? okAsync(undefined) : this.#keep(device, named.id, generation),
        )
    }).andThen((device) =>
      device === undefined ? okAsync(undefined) : this.#open(device, generation),
    )
  }

  /**
   * Makes the sign-in whole: until then its token lives here only, and nothing reaches the
   * browser's storage, which the other tabs follow. The memberships are read with the token and
   * the device it names; then, while the session is still open and no other account was saved
   * meanwhile, the identity, the token and the memberships are saved in one step. Every way out
   * that does not keep this attempt's token leaves it to be signed out (at once while the browser
   * is online, else kept for later), never another tab's. A throw while it holds the token (the
   * read, the save) lets go of it (`cleanUpSignIn`, a save it broke off midway undone) and fails
   * as `brokenSignIn`, naming nothing of the throw.
   */
  #keep(
    device: SignedInDevice,
    named: string,
    generation: number,
  ): ResultAsync<SignedInDevice, DataError> {
    const whole = () => this.#stillWhole(device, generation)
    const kept = async (): Promise<Result<SignedInDevice, DataError>> => {
      try {
        return await whole()
          .andThen(() => this.#host.options.listMemberships(device.token, named))
          .andThen((memberships) => whole().map(() => memberships))
          .map((memberships) => {
            saveDevice(this.#host.options.storage, { ...device, memberships })

            return device
          })
          .orElse((error) => this.#abandon<SignedInDevice>(device.token, error))
      } catch {
        cleanUpSignIn(this.#host.options.storage, this.#pendingRevoke, device.token)

        return err(brokenSignIn())
      }
    }

    return new ResultAsync(kept())
  }

  /**
   * Opens the space of the device a sign-in saved. One that does not open lets go of this
   * attempt's token (`cleanUpSignIn`: left to sign out first, then the device forgotten while the
   * saved token is still this attempt's) and fails with the open's error; an open or a cleanup
   * that threw fails as `brokenSignIn`, naming nothing of the throw. Closed meanwhile, or open
   * before a throw, the device stays saved, whole, for the next start.
   */
  #open(device: SignedInDevice, generation: number): ResultAsync<AuthUser, DataError> {
    const opened = async (): Promise<Result<AuthUser, DataError>> => {
      let failure: DataError

      try {
        const result = await this.openSpace(device.identity, generation)

        if (result.isOk()) {
          return result
        }

        failure = result.error
      } catch {
        failure = brokenSignIn()
      }

      if (generation !== this.#host.generation() || this.#host.open()) {
        return err(failure)
      }

      return cleanUpSignIn(this.#host.options.storage, this.#pendingRevoke, device.token)
        ? err(failure)
        : err(brokenSignIn())
    }

    return new ResultAsync(opened())
  }

  /** Leaves `token`, which this attempt does not keep, to be signed out, and fails with `error`. */
  #abandon<T>(token: string, error: DataError): ResultAsync<T, DataError> {
    this.#pendingRevoke.leave(token)

    return errAsync(error)
  }

  /**
   * Whether the sign-in may still be kept: the session was not closed meanwhile, and no other
   * tab saved another account (one account per browser).
   */
  #stillWhole(device: SignedInDevice, generation: number): ResultAsync<void, DataError> {
    if (generation !== this.#host.generation()) {
      return errAsync(closedDuringSignIn())
    }

    return otherIdentitySaved(this.#host.options.storage, device.identity.id)
      ? errAsync(otherAccountSignedIn())
      : okAsync(undefined)
  }
}
