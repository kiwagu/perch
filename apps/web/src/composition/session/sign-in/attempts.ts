/**
 * The attempts to sign this browser in: a sign-in (a password, a code, a passkey) or a
 * verification link's exchange, one at a time in the browser's sign-in lock, the device it signed
 * in kept whole or let go of, and the restore of the identity an earlier sign-in saved.
 */

import { err, errAsync, okAsync, type Result, ResultAsync } from 'neverthrow'

import type { AuthUser, DataError } from '@workspace/data'

import type { NamedDevice, SignedInDevice } from '../../gateway-auth'
import {
  deviceIdFrom,
  dropUnreadableSignIn,
  markSignIn,
  newSignInId,
  type SavedSignIn,
  saveDevice,
  savedSignIn,
} from '../../storage'
import type { SessionHost } from '../host'
import { otherAccountSignedIn, otherIdentitySaved } from '../one-account'
import type { PendingRevoke } from '../pending-revoke'
import type { SpaceDeletion } from '../space-deletion'

import { cleanUpSignIn } from './cleanup'
import { closedDuringSignIn } from './closed'
import { brokenSignIn, oneSignInAtATime } from './lock'
import { type OpenSpaceDeps, openSpaceOf } from './space'

/**
 * What an attempt's gateway call came to: a device to keep, with how the user it signs in answers
 * the attempt (`signedIn`), or an answer that signs nothing in (`stopped`).
 */
export type Asked<Answer> =
  | { readonly device: SignedInDevice; readonly signedIn: (user: AuthUser) => Answer }
  | { readonly stopped: Answer }

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

  /** Opens the space of the sign-in saved now, if any; see `SessionService.restore`. */
  restore(generation: number): ResultAsync<AuthUser | undefined, DataError> {
    const storage = this.#host.options.storage
    const saved = savedSignIn(storage)

    if (this.#host.options.online()) {
      void this.#pendingRevoke.send()
    }

    // What sign-outs left behind goes meanwhile: the databases of anyone but the saved identity.
    void this.#deletion.deleteLeftovers()

    if (saved) {
      return this.openSpace(saved, generation)
    }

    // A record that names nobody is not a session.
    dropUnreadableSignIn(storage)

    return okAsync(undefined)
  }

  openSpace(signedIn: SavedSignIn, generation: number): ResultAsync<AuthUser, DataError> {
    // The previous identity leaves with its space: nobody is current until the new one is open.
    this.#host.leaveAndTell()
    this.#host.options.onStep?.('open-db')

    // A delete of the identity's databases under way in any tab ends first; none starts meanwhile.
    return this.#deletion.open(signedIn.user.id, () =>
      openSpaceOf(this.#spaces, signedIn, generation),
    )
  }

  /** This browser as a sign-in or a verification names it. */
  device(): NamedDevice {
    return { id: deviceIdFrom(this.#host.options.storage), label: this.#host.options.deviceLabel }
  }

  /**
   * Signs this browser in through `ask`, which names the device to the gateway (a sign-in, a
   * code step, a passkey, a verification link's exchange) and answers a device to keep or an answer
   * that signs nothing in (`Asked`): nothing is kept, nothing opens, and the attempt answers that.
   * One account per browser: `otherAccount` says, inside the lock and before the gateway is asked,
   * whether another account than the one asked for is signed in on this browser (a sign-in knows
   * the email it asks for; a passkey, any saved account); it is refused at once then. Without one
   * (a link names no email), only once the answer came, as is any sign-in that finds another
   * account saved by then. The tokens sign-outs left are signed out first: the sign-in replaces
   * the device's session at the gateway, which a token left after it would no longer name.
   */
  enter<Answer>(
    otherAccount: (() => boolean) | undefined,
    ask: (device: NamedDevice) => ResultAsync<Asked<Answer>, DataError>,
    generation: number,
  ): ResultAsync<Answer, DataError> {
    const named = this.device()

    // The browser's tabs sign in one at a time, from the request to the saved device; the space
    // opens once the lock is let go.
    return oneSignInAtATime(this.#host.options.locks, () => {
      // A session closed while the lock was awaited asks the gateway nothing.
      if (generation !== this.#host.generation()) {
        return errAsync(closedDuringSignIn())
      }

      const ready: ResultAsync<void, DataError> = otherAccount?.()
        ? errAsync(otherAccountSignedIn())
        : ResultAsync.fromSafePromise(this.#pendingRevoke.send())

      return ready
        .andThen(() => ask(named))
        .andThen((asked) =>
          'stopped' in asked
            ? okAsync(asked)
            : this.#keep(asked.device, named.id, generation).map((saved) => ({
                saved,
                signedIn: asked.signedIn,
              })),
        )
    }).andThen((entered) =>
      'stopped' in entered
        ? okAsync(entered.stopped)
        : this.#open(entered.saved, generation).map(entered.signedIn),
    )
  }

  /**
   * Makes the sign-in whole: until then its token lives here only, and nothing reaches the
   * browser's storage, which the other tabs follow. The attempt names itself first, by an id of
   * its own (`newSignInId`), which every record it writes is kept under and its cleanup removes.
   * The memberships are read with the token and the device it names; then, while the session is
   * still open and no other account was saved meanwhile, the start of an account that has not
   * started is kept (`keepAccountStart`), and the identity, the token and the memberships are
   * saved in one step. Every way out that does not keep this attempt's token leaves it to be
   * signed out (at once while the browser is online, else kept for later), never another tab's.
   * A throw while it holds the token (the read, the save) lets go of it and of every record it
   * wrote (`cleanUpSignIn`) and fails as `brokenSignIn`, naming nothing of the throw.
   */
  #keep(
    device: SignedInDevice,
    named: string,
    generation: number,
  ): ResultAsync<SavedSignIn, DataError> {
    const signedIn: SavedSignIn = {
      session: { signIn: newSignInId(), identity: device.identity.id, token: device.token },
      user: device.identity,
    }
    const whole = () => this.#stillWhole(device, generation)
    const kept = async (): Promise<Result<SavedSignIn, DataError>> => {
      try {
        return await whole()
          .andThen(() => this.#host.options.listMemberships(device.token, named))
          .andThen((memberships) => whole().map(() => memberships))
          .map((memberships) => {
            // The start of an account that has none is kept before the device: a tab that follows
            // the saved identity finds it there.
            if (device.start !== undefined) {
              this.#host.options.keepAccountStart(
                signedIn.session.signIn,
                device.identity,
                device.start,
              )
            }

            saveDevice(this.#host.options.storage, signedIn.session.signIn, {
              ...device,
              memberships,
            })
            // The words left for the sign-in page so far end with this sign-in, in every tab.
            markSignIn(this.#host.options.storage)

            return signedIn
          })
          .orElse((error) => this.#abandon<SavedSignIn>(device.token, error))
      } catch {
        cleanUpSignIn(this.#host.options.storage, this.#pendingRevoke, signedIn.session)

        return err(brokenSignIn())
      }
    }

    return new ResultAsync(kept())
  }

  /**
   * Opens the space of the sign-in an attempt saved. One that does not open lets go of this
   * attempt's token and records (`cleanUpSignIn`: the token left to sign out first, then what
   * the attempt kept under its id forgotten, whatever another tab saved since) and fails with the
   * open's error; an open or a cleanup that threw fails as `brokenSignIn`, naming nothing of the
   * throw. Closed meanwhile, or open before a throw, the device stays saved, whole, for the next
   * start.
   */
  #open(signedIn: SavedSignIn, generation: number): ResultAsync<AuthUser, DataError> {
    const opened = async (): Promise<Result<AuthUser, DataError>> => {
      let failure: DataError

      try {
        const result = await this.openSpace(signedIn, generation)

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

      return cleanUpSignIn(this.#host.options.storage, this.#pendingRevoke, signedIn.session)
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
