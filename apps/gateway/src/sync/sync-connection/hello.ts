/**
 * A device's hello, from its key check to its welcome. Keys the database refuses close the hello
 * with 4401; keys it could not judge, as a failed server (1011), and a renewal the limits refused,
 * with 1013 (try again later): the device comes back with them. A hello is bound to its device's
 * row: a device without one is closed with 4401, a device signed out with 4001, and a pair renewed
 * for either is revoked at once; a renewal moves the row to the new grant. A pair renewed at a
 * hello whose socket closed before it could take it is parked for the device's next hello with
 * the spent refresh key, which is sent it before its welcome. The device is marked seen at its
 * hello and then at most every five minutes it talks. A device holds one live socket: the hello
 * that registers closes its older ones (1000), without signing it out. Its key operations, a hello
 * from its key check to its registration and a renewal over the channel, run one at a time across
 * its sockets, so no two spend one refresh key. An organisation whose database cannot be read is
 * left out of the welcome (`welcome-heads.ts`); the identity's own region failing fails the hello.
 */

import type { Logger } from '@workspace/logger'
import type { Clock, ReplicaSchema } from '@workspace/replica'
import { CLOSE, type ClientMessage } from '@workspace/replica/protocol'
import type { RegionHub } from '@workspace/replica/server'

import type { DeviceSessions } from '../../auth/device-sessions'
import { type IdentitySessions, keysRefused, type RenewalGate } from '../../auth/identity-sessions'
import type { Organisations } from '../../tenants/organisations'
import type { ConnectionRegistry, MembershipsListener } from '../connections'

import type { ConnectedDevice } from './connected-device'
import { regionsFor } from './device-regions'
import type { DeviceSeen } from './device-seen'
import { acceptKeys, bindDevice, TRY_AGAIN_LATER } from './hello-keys'
import type { HelloRenewals } from './hello-renewals'
import type { ConnectionHost } from './host'
import { REASON } from './reasons'
import type { RegionChanges } from './region-changes'
import { welcomeHeads } from './welcome-heads'

/** The hello of a device. */
export type Hello = Extract<ClientMessage, { readonly type: 'hello' }>

export interface ConnectionHelloDeps {
  readonly sessions: Pick<IdentitySessions, 'authenticate' | 'exclusively' | 'park' | 'parked'>
  readonly devices: Pick<DeviceSessions, 'bind' | 'rotate'>
  readonly hub: Pick<RegionHub, 'heads'>
  readonly organisations: Pick<Organisations, 'membershipsOf'>
  readonly connections: Pick<ConnectionRegistry, 'epoch' | 'add' | 'supersede'>
  /** The gate a hello of `device` asks before its refresh key is exchanged: the renewal limits. */
  readonly renewals: (device: string) => RenewalGate
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
  /** Pairs renewed for the device that it cannot take: dropped or parked. */
  readonly pairs: HelloRenewals
  readonly changes: Pick<RegionChanges, 'welcomed'>
}

export class ConnectionHello {
  readonly #sessions: ConnectionHelloDeps['sessions']
  readonly #devices: ConnectionHelloDeps['devices']
  readonly #hub: ConnectionHelloDeps['hub']
  readonly #organisations: ConnectionHelloDeps['organisations']
  readonly #connections: ConnectionHelloDeps['connections']
  readonly #renewalGate: ConnectionHelloDeps['renewals']
  readonly #clock: Clock
  readonly #schema: ReplicaSchema
  readonly #log: Logger
  readonly #host: ConnectionHost
  readonly #listener: MembershipsListener
  readonly #registered: (unregister: () => void) => void
  readonly #seen: DeviceSeen
  readonly #pairs: HelloRenewals
  readonly #changes: Pick<RegionChanges, 'welcomed'>

  constructor(deps: ConnectionHelloDeps, options: ConnectionHelloOptions) {
    this.#sessions = deps.sessions
    this.#devices = deps.devices
    this.#hub = deps.hub
    this.#organisations = deps.organisations
    this.#connections = deps.connections
    this.#renewalGate = deps.renewals
    this.#clock = deps.clock
    this.#schema = deps.schema
    this.#log = deps.log
    this.#host = options.host
    this.#listener = options.listener
    this.#registered = options.registered
    this.#seen = options.seen
    this.#pairs = options.pairs
    this.#changes = options.changes
  }

  /** Says the hello: the keys, the connection in the device's place, then the welcome. */
  async say(hello: Hello): Promise<void> {
    // The keys are checked, renewed and handed over, and the connection takes the device's place,
    // as its one key operation under way: no other socket of the device spends a key meanwhile.
    const entered = await this.#sessions.exclusively(hello.device, () => this.#enter(hello))

    if (entered === undefined) {
      return
    }

    const { identity, tokens } = entered
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
      tokens,
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
  }

  /**
   * Accepts the hello's keys, hands over a renewed pair and registers the connection in place of
   * the device's older ones, which close. The identity and the keys the device holds now, or
   * undefined once the socket closed.
   */
  async #enter(hello: Hello): Promise<Pick<ConnectedDevice, 'identity' | 'tokens'> | undefined> {
    const { access, refresh, device: deviceId } = hello
    const accepted = await acceptKeys(
      this.#sessions,
      { device: deviceId, access, refresh },
      this.#renewalGate(deviceId),
    )

    if (accepted.isErr()) {
      // Keys the database could not judge are not refused: the device keeps them and comes back,
      // as it does after a renewal the limits refused, which is not logged.
      if (keysRefused(accepted.error)) {
        this.#host.close(CLOSE.unauthorized, REASON.refused)
      } else if (accepted.error.code === 'data:RATE_LIMITED') {
        this.#host.close(TRY_AGAIN_LATER, REASON.tooManyRenewals)
      } else {
        this.#host.fail(accepted.error)
      }

      return undefined
    }

    const { identity, deliver, spent } = accepted.value
    // Read once the keys are accepted and before the row is: a sign-out of the device from now
    // on refuses the registration, one before is seen by the read.
    const epoch = this.#connections.epoch(identity.id, deviceId)

    if (this.#host.isClosed() && spent === undefined) {
      // A parked pair the socket closed before it could take waits again for the next hello.
      if (deliver && refresh !== undefined) {
        this.#pairs.park(identity.id, deviceId, refresh, deliver)
      }

      return undefined
    }

    const binding = await bindDevice(this.#devices, {
      identity: identity.id,
      device: deviceId,
      accepted: accepted.value,
    })
    const bound = binding.isOk() && binding.value.kind === 'bound'

    // A pair renewed for a device that has no session must not live: nobody may take it.
    if (spent !== undefined && deliver && !bound) {
      await this.#pairs.drop(identity.id, deliver)
    }

    if (this.#host.isClosed()) {
      // The device's refresh key is spent and the pair that replaces it cannot reach it now: it
      // waits for the device's next hello with that key.
      if (bound && deliver && refresh !== undefined) {
        this.#pairs.park(identity.id, deviceId, refresh, deliver)
      }

      return undefined
    }

    if (binding.isErr()) {
      this.#host.fail(binding.error)

      return undefined
    }

    const kind = binding.value.kind

    if (kind === 'revoked') {
      this.#host.close(CLOSE.revoked, REASON.revoked)

      return undefined
    }

    if (kind !== 'bound') {
      this.#host.close(CLOSE.unauthorized, REASON.noSession)

      return undefined
    }

    // The new pair goes out first, before anything else is awaited: the key the device holds
    // is spent already.
    if (deliver && !this.#host.sendTokens(identity.id, deviceId, refresh, deliver)) {
      return undefined
    }

    // Registered before the memberships are read: a change from then on reaches the device
    // after its welcome, in turn with its messages. A sign-out of the device since the epoch was
    // read refuses it.
    const unregister = this.#connections.add(identity.id, deviceId, this.#listener, epoch)

    if (!unregister) {
      this.#host.close(CLOSE.revoked, REASON.revoked)

      return undefined
    }

    this.#registered(unregister)

    // A renewal marked the device seen as it moved the row to the new grant.
    if (spent === undefined) {
      this.#seen.mark(identity.id, deviceId)
    } else {
      this.#seen.renewed()
    }

    // The device holds one live socket: an older one it gave up spends none of its keys.
    this.#connections.supersede(identity.id, deviceId, this.#listener)

    return { identity, tokens: accepted.value.tokens }
  }
}
