/**
 * What a welcomed device asks over its channel: the region requests the hub answers itself
 * (subscribe, pull, push, compact, probe), and a sign-out. A message that names a region the
 * device may not name is refused and closes the socket. A sign-out ends the session the device's
 * hello came with, as the sign-out route does, and closes every socket of the device: the
 * sign-out close (4000) means the session ended, and a session that cannot be ended closes the
 * socket as a failed server (1011) instead.
 */

import type { Result } from 'neverthrow'
import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'
import { CLOSE, type ClientMessage } from '@workspace/replica/protocol'
import type { RegionHub } from '@workspace/replica/server'

import type { AuthSessions } from '../../auth/auth-sessions'
import type { ConnectionRegistry } from '../connections'

import { signOutOnChannel } from './channel-sign-out'
import type { ConnectedDevice } from './connected-device'
import { regionsOf } from './device-regions'
import type { ConnectionHost } from './host'
import { REASON } from './reasons'
import type { RegionSubscriptions } from './region-subscriptions'

export interface DeviceRequestsDeps {
  readonly sessions: Pick<AuthSessions, 'signOut'>
  /** Closes every socket of a device that signed out. */
  readonly connections: Pick<ConnectionRegistry, 'close'>
  readonly hub: Pick<RegionHub, 'subscribe' | 'pull' | 'push' | 'heads' | 'compact'>
  readonly clock: Clock
  /** Hears sign-outs that fail; no line carries a token. */
  readonly log: Logger
}

export interface DeviceRequestsOptions {
  readonly host: ConnectionHost
  readonly subscriptions: RegionSubscriptions
}

export class DeviceRequests {
  readonly #sessions: DeviceRequestsDeps['sessions']
  readonly #connections: DeviceRequestsDeps['connections']
  readonly #hub: DeviceRequestsDeps['hub']
  readonly #clock: Clock
  readonly #log: Logger
  readonly #host: ConnectionHost
  readonly #subscriptions: RegionSubscriptions

  constructor(deps: DeviceRequestsDeps, options: DeviceRequestsOptions) {
    this.#sessions = deps.sessions
    this.#connections = deps.connections
    this.#hub = deps.hub
    this.#clock = deps.clock
    this.#log = deps.log
    this.#host = options.host
    this.#subscriptions = options.subscriptions
  }

  /** Serves one message of the welcomed `device`, in turn with its other messages. */
  async serve(device: ConnectedDevice, message: ClientMessage): Promise<void> {
    if (!regionsOf(message).every((region) => device.regions.has(region))) {
      this.#host.send({ type: 'error', code: 'forbidden-region', message: REASON.forbidden })
      this.#host.close(CLOSE.forbidden, REASON.forbidden)

      return
    }

    const subscriber = this.#subscriptions.subscriber

    await match(message)
      .with({ type: 'hello' }, async () => this.#host.close(CLOSE.protocol, REASON.helloTwice))
      .with({ type: 'sign-out' }, () => this.#signOut(device))
      .with({ type: 'subscribe' }, async ({ region, vv }) => {
        const entry = device.regions.get(region)

        // Checked above: the device may name the region.
        if (entry) {
          this.#subscriptions.add(region)
          this.#settle(await this.#hub.subscribe(entry.ref, entry.actor, subscriber, vv))
        }
      })
      .with({ type: 'pull' }, async ({ region, vv }) => {
        this.#settle(await this.#hub.pull(region, subscriber, vv))
      })
      .with({ type: 'push' }, async ({ region, batch, updates }) => {
        this.#settle(await this.#hub.push(region, subscriber, batch, updates))
      })
      .with({ type: 'compact' }, async ({ region, covers, snapshot }) => {
        this.#settle(await this.#hub.compact(region, subscriber, covers, snapshot))
      })
      .with({ type: 'probe' }, async ({ regions }) => {
        const heads = await this.#hub.heads(regions)

        if (this.#host.isClosed()) {
          return
        }

        if (heads.isErr()) {
          this.#host.fail(heads.error)

          return
        }

        this.#host.send({ type: 'heads', regions: [...heads.value], time: this.#clock.now() })
      })
      .exhaustive()
  }

  /** Leaves the device's regions, ends its session (`signOutOnChannel`) and closes as it answers. */
  async #signOut(device: ConnectedDevice): Promise<void> {
    this.#subscriptions.leaveAll()

    const close = await signOutOnChannel(
      { sessions: this.#sessions, connections: this.#connections, log: this.#log },
      { identity: device.identity.id, device: device.id, token: device.token },
    )

    this.#host.close(close.code, close.reason)
  }

  /**
   * The hub answers the device itself, failures included, and resolves without an error;
   * an error it returns all the same was not expected.
   */
  #settle(result: Result<void, DataError>): void {
    if (result.isErr()) {
      this.#host.fail(result.error)
    }
  }
}
