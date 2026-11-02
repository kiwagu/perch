/**
 * A device's hello, from the read of its session to its welcome. The hello carries the device's
 * session token: a token that reads no live session closes the hello with 4401, as does a session
 * of another device than the one the hello names; a read the directory could not make closes it
 * as a failed server (1011), and the device comes back with the same token. A device signed out
 * from another one while its session is read is closed with 4001. The device is marked seen at
 * its hello and then at most every five minutes it talks. A device holds one live socket: the
 * hello that registers closes its older ones (1000), without signing it out. An organisation
 * whose database cannot be read is left out of the welcome (`welcome-heads.ts`); the identity's
 * own region failing fails the hello. Once the device is welcomed, the account's email and its
 * profile's are compared (`ProfileEmails.reconcile`), without holding the hello.
 */

import type { AuthUser } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import { CLOSE, type ClientMessage } from '@workspace/replica/protocol'
import type { RegionHub } from '@workspace/replica/server'

import type { AuthSessions } from '../../auth/auth-sessions'
import type { ProfileEmails } from '../../auth/profile-emails'
import type { Organisations } from '../../tenants/organisations'
import type { ConnectionRegistry, MembershipsListener } from '../connections'

import type { ConnectedDevice } from './connected-device'
import { regionsFor } from './device-regions'
import type { DeviceSeen } from './device-seen'
import type { ConnectionHost } from './host'
import { REASON } from './reasons'
import type { RegionChanges } from './region-changes'
import { welcomeHeads } from './welcome-heads'

/** The hello of a device. */
export type Hello = Extract<ClientMessage, { readonly type: 'hello' }>

export interface ConnectionHelloDeps {
  readonly sessions: Pick<AuthSessions, 'read'>
  readonly hub: Pick<RegionHub, 'heads'>
  readonly organisations: Pick<Organisations, 'membershipsOf'>
  /** Compares the account's email with its profile's once the device is welcomed. */
  readonly profiles: Pick<ProfileEmails, 'reconcile'>
  readonly connections: Pick<ConnectionRegistry, 'epoch' | 'add' | 'supersede'>
  readonly clock: Clock
  /** Who may write what in each region: the abilities of a member are built from it. */
  readonly schema: ReplicaSchema
  /** Hears a region left out of the welcome. */
  readonly log: Logger
}

export interface ConnectionHelloOptions {
  readonly host: ConnectionHost
  /** The connection as the registry holds it: it hears the identity's memberships change. */
  readonly listener: MembershipsListener
  /** Keeps what takes the connection out of the registry again, in the tick it registered. */
  readonly registered: (unregister: () => void) => void
  readonly seen: DeviceSeen
  readonly changes: Pick<RegionChanges, 'welcomed'>
}

export class ConnectionHello {
  readonly #sessions: ConnectionHelloDeps['sessions']
  readonly #hub: ConnectionHelloDeps['hub']
  readonly #organisations: ConnectionHelloDeps['organisations']
  readonly #profiles: ConnectionHelloDeps['profiles']
  readonly #connections: ConnectionHelloDeps['connections']
  readonly #clock: Clock
  readonly #schema: ReplicaSchema
  readonly #log: Logger
  readonly #host: ConnectionHost
  readonly #listener: MembershipsListener
  readonly #registered: (unregister: () => void) => void
  readonly #seen: DeviceSeen
  readonly #changes: Pick<RegionChanges, 'welcomed'>

  constructor(deps: ConnectionHelloDeps, options: ConnectionHelloOptions) {
    this.#sessions = deps.sessions
    this.#hub = deps.hub
    this.#organisations = deps.organisations
    this.#profiles = deps.profiles
    this.#connections = deps.connections
    this.#clock = deps.clock
    this.#schema = deps.schema
    this.#log = deps.log
    this.#host = options.host
    this.#listener = options.listener
    this.#registered = options.registered
    this.#seen = options.seen
    this.#changes = options.changes
  }

  /** Says the hello: the session, the connection in the device's place, then the welcome. */
  async say(hello: Hello): Promise<void> {
    const identity = await this.#enter(hello)

    if (identity === undefined) {
      return
    }

    const memberships = await this.#organisations.membershipsOf(identity.id)

    if (this.#host.isClosed()) {
      return
    }

    if (memberships.isErr()) {
      this.#host.fail(memberships.error)

      return
    }

    const device: ConnectedDevice = {
      id: hello.device,
      identity,
      token: hello.token,
      regions: regionsFor(identity.id, memberships.value, this.#schema),
    }
    const heads = await welcomeHeads(this.#hub, device.regions, this.#log)

    if (this.#host.isClosed()) {
      return
    }

    if (heads.isErr()) {
      this.#host.fail(heads.error)

      return
    }

    this.#host.ready(device)
    this.#host.send({
      type: 'welcome',
      identity: identity.id,
      regions: heads.value.map(({ region, head }) => ({ region, head })),
      memberships: [...memberships.value],
      time: this.#clock.now(),
    })

    // What changed since the memberships were read applies before any later message is handled.
    this.#changes.welcomed()
    // The profile's email follows the account's: one read, after the welcome, and a write in the
    // account's turn only when they differ (a gateway that stopped before a confirmed email
    // reached the profile, or a profile a device created with an email the account left).
    void this.#profiles.reconcile(identity.id)
  }

  /**
   * Reads the hello's session and registers the connection in place of the device's older ones,
   * which close. The identity the session belongs to, or undefined once the socket closed.
   */
  async #enter(hello: Hello): Promise<AuthUser | undefined> {
    // Read before the session: a sign-out of the device from now on refuses the registration, one
    // before ended the session the read finds.
    const epoch = this.#connections.epoch()
    const read = await this.#sessions.read(hello.token)

    if (this.#host.isClosed()) {
      return undefined
    }

    if (read.kind === 'failed') {
      // A read the directory could not make does not refuse the token: the device comes back.
      this.#host.fail(read.error)

      return undefined
    }

    if (read.kind === 'none') {
      this.#host.close(CLOSE.unauthorized, REASON.refused)

      return undefined
    }

    const { caller } = read

    // A session is bound to the device it was opened on: another device may not say hello with it.
    if (caller.device !== hello.device) {
      this.#host.close(CLOSE.unauthorized, REASON.noSession)

      return undefined
    }

    // Registered before the memberships are read: a change from then on reaches the device
    // after its welcome, in turn with its messages.
    const unregister = this.#connections.add(caller.identity, hello.device, this.#listener, epoch)

    if (!unregister) {
      this.#host.close(CLOSE.revoked, REASON.revoked)

      return undefined
    }

    this.#registered(unregister)
    this.#seen.mark(caller.identity, hello.device)
    // The device holds one live socket: an older one it gave up is served no more.
    this.#connections.supersede(caller.identity, hello.device, this.#listener)

    return { id: caller.identity, email: caller.email }
  }
}
