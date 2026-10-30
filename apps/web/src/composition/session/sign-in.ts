/**
 * Signing up or in, and restoring the identity an earlier sign-in saved: the session enters the
 * device the gateway signed in and opens the identity's space.
 */

import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow'

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
      () => this.#host.options.auth.signUp(input, this.#device()),
      generation,
    )
  }

  signIn(input: SignInInput, generation: number): ResultAsync<AuthUser, DataError> {
    return this.#signInAs(
      input.email,
      () => this.#host.options.auth.signIn(input, this.#device()),
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
   * browser (one account per browser). The pairs sign-outs left are revoked first: the sign-in
   * moves the device's session at the gateway to a new grant, after which they match it no more.
   */
  #signInAs(
    email: string,
    ask: () => ResultAsync<SignedInDevice, DataError>,
    generation: number,
  ): ResultAsync<AuthUser, DataError> {
    const ready: ResultAsync<void, DataError> = otherAccountSaved(this.#host.options.storage, email)
      ? errAsync(otherAccountSignedIn())
      : ResultAsync.fromSafePromise(this.#pendingRevoke.send())

    return ready.andThen(ask).andThen((device) => this.#enter(device, generation))
  }

  #enter(device: SignedInDevice, generation: number): ResultAsync<AuthUser, DataError> {
    const storage = this.#host.options.storage

    if (generation !== this.#host.generation()) {
      return errAsync(closedDuringSignIn())
    }

    // Another tab signed someone else in meanwhile: this sign-in's new pair goes to be revoked.
    if (otherIdentitySaved(storage, device.identity.id)) {
      this.#pendingRevoke.leave(device.tokens)

      return errAsync(otherAccountSignedIn())
    }

    // The keys are kept first: the space's channel presents them as soon as this tab leads.
    saveDevice(storage, device)

    return this.openSpace(device.identity, generation).orElse((error) => {
      if (generation === this.#host.generation()) {
        forgetDevice(storage)
      }

      return errAsync(error)
    })
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
