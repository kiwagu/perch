/**
 * Signing up or in, and restoring the identity an earlier sign-in saved: the session enters the
 * device the gateway signed in and opens the identity's space.
 */

import { err, errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow'

import {
  type AuthUser,
  type DataError,
  dataError,
  type SignInInput,
  type SignUpInput,
} from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import { leadership, lockName } from '@workspace/replica/sync'

import type { NamedDevice, SignedInDevice } from '../gateway-auth'
import { openIdentitySpace } from '../identity-space'
import { deviceIdFrom, forgetDevice, IDENTITY_KEY, saveDevice, savedIdentity } from '../storage'

import type { SessionHost } from './host'
import { otherAccountSaved, otherAccountSignedIn, otherIdentitySaved } from './one-account'
import type { SpaceStatus } from './open-space'
import type { TransportContext } from './options'
import type { SessionOrganisations } from './organisations'
import type { PendingRevoke } from './pending-revoke'
import { rejectionOf } from './push-rejection'
import { cleanUpSignIn } from './sign-in-cleanup'
import { brokenSignIn, oneSignInAtATime } from './sign-in-lock'
import type { SpaceDeletion } from './space-deletion'
import type { HeardSignOut, WriteBarrier } from './write-barrier'

const closedDuringSignIn = () =>
  dataError('data:AUTH_FAILED', 'the session was closed during this sign-in')

export interface SessionSignInOptions {
  readonly host: SessionHost
  readonly organisations: SessionOrganisations
  readonly barrier: WriteBarrier
  readonly pendingRevoke: PendingRevoke
  readonly deletion: SpaceDeletion
  /** What the channel of an identity's space tells the session (`SessionElsewhere`). */
  readonly transportContext: (identity: IdentityId) => TransportContext
}

export class SessionSignIn {
  readonly #host: SessionHost
  readonly #organisations: SessionOrganisations
  readonly #barrier: WriteBarrier
  readonly #pendingRevoke: PendingRevoke
  readonly #deletion: SpaceDeletion
  readonly #transportContext: (identity: IdentityId) => TransportContext

  constructor(options: SessionSignInOptions) {
    this.#host = options.host
    this.#organisations = options.organisations
    this.#barrier = options.barrier
    this.#pendingRevoke = options.pendingRevoke
    this.#deletion = options.deletion
    this.#transportContext = options.transportContext
  }

  signUp(input: SignUpInput, generation: number): ResultAsync<AuthUser, DataError> {
    return this.#signInAs(
      input.email,
      (device) => this.#host.options.auth.signUp(input, device),
      generation,
    )
  }

  signIn(input: SignInInput, generation: number): ResultAsync<AuthUser, DataError> {
    return this.#signInAs(
      input.email,
      (device) => this.#host.options.auth.signIn(input, device),
      generation,
    )
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
    return this.#deletion.open(identity.id, () => this.#openSpaceNow(identity, generation))
  }

  /** This browser as a sign-up or sign-in names it. */
  #device(): NamedDevice {
    return { id: deviceIdFrom(this.#host.options.storage), label: this.#host.options.deviceLabel }
  }

  /**
   * Signs up or in through `ask`, refused at once while another account is signed in on this
   * browser (one account per browser). The tokens sign-outs left are signed out first: the
   * sign-in replaces the device's session at the gateway, which a token left after it would no
   * longer name.
   */
  #signInAs(
    email: string,
    ask: (device: NamedDevice) => ResultAsync<SignedInDevice, DataError>,
    generation: number,
  ): ResultAsync<AuthUser, DataError> {
    const named = this.#device()

    // The browser's tabs sign in one at a time, from the request to the saved device; the space
    // opens once the lock is let go.
    return oneSignInAtATime(this.#host.options.locks, () => {
      // A session closed while the lock was awaited asks the gateway nothing.
      if (generation !== this.#host.generation()) {
        return errAsync(closedDuringSignIn())
      }

      const ready: ResultAsync<void, DataError> = otherAccountSaved(
        this.#host.options.storage,
        email,
      )
        ? errAsync(otherAccountSignedIn())
        : ResultAsync.fromSafePromise(this.#pendingRevoke.send())

      return ready
        .andThen(() => ask(named))
        .andThen((device) => this.#keep(device, named.id, generation))
    }).andThen((device) => this.#open(device, generation))
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

  #openSpaceNow(identity: AuthUser, generation: number): ResultAsync<AuthUser, DataError> {
    const options = this.#host.options
    const status: SpaceStatus = { live: true }
    const lead = leadership(options.locks, lockName(identity.id))
    const hints = options.hints(identity.id)
    const heard: HeardSignOut = { at: undefined }

    // Another tab's sign-out holds this tab's writes back until it ends; the space closes the hints.
    hints.on((hint) => this.#barrier.hear(heard, hint))

    return openIdentitySpace({
      identity,
      openLocal: options.openLocal,
      openTenantLocal: options.openTenantLocal,
      deleteTenantLocal: options.deleteTenantLocal,
      tenantDatabases: this.#organisations.databases(identity.id),
      ...this.#organisations.saved(identity.id),
      schema: options.schema,
      transport: () => options.transport(this.#transportContext(identity.id)),
      leadership: lead,
      hints,
      clock: options.clock,
      onState: (state) => {
        if (status.live) {
          options.onSyncState(state)
        }
      },
      onError: (error) => this.#report(error),
    })
      .mapErr((error) => {
        status.live = false

        return error
      })
      .andThen((space) => {
        if (generation !== this.#host.generation()) {
          status.live = false
          this.#host.retire(space.close())

          return err(closedDuringSignIn())
        }

        this.#host.opened({ space, leadership: lead, status, hints, heard })
        space.visibility(options.visibility.current())
        options.onStep?.('ready')
        this.#host.emit(identity)

        return ok(identity)
      })
  }

  /** Reports an error of the space; a refused push is also published (`sync.change-rejected`, `sync.changes-reloaded`). */
  #report(error: DataError): void {
    const rejection = rejectionOf(error)

    if (rejection) {
      const about = {
        payload: rejection,
        actorId: this.#host.open()?.space.identity.id ?? 'anonymous',
        occurredAt: new Date(),
      }

      this.#host.options.publish(
        rejection.reloaded
          ? { name: 'sync.changes-reloaded', ...about }
          : { name: 'sync.change-rejected', ...about },
      )
    }

    this.#host.options.onError(error)
  }
}
