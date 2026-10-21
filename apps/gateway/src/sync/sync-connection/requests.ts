/**
 * What a welcomed device asks over its channel: the region requests the hub answers itself
 * (subscribe, pull, push, compact, probe), new keys, and a sign-out. A message that names a
 * region the device may not name is refused and closes the socket. A sign-out marks the device's
 * row signed out, forgets the pairs parked for it and revokes its refresh grant through the
 * database, as the sign-out route does: the sign-out close (4000) means the grant is revoked, and
 * a row that cannot be marked or a grant that cannot be revoked closes the socket as a failed
 * server (1011) instead.
 */

import type { Result } from 'neverthrow'
import { match } from 'ts-pattern'

import type { DataError } from '@workspace/data'
import type { Logger } from '@workspace/logger'
import type { Clock } from '@workspace/replica'
import { CLOSE, type ClientMessage } from '@workspace/replica/protocol'
import type { RegionHub } from '@workspace/replica/server'

import type { DeviceSessions } from '../../auth/device-sessions'
import type { IdentitySessions, RenewalGate } from '../../auth/identity-sessions'

import { type ChannelRenewal, renewOnChannel } from './channel-renewal'
import { signOutOnChannel } from './channel-sign-out'
import type { ConnectedDevice } from './connected-device'
import { regionsOf } from './device-regions'
import type { DeviceSeen } from './device-seen'
import type { HelloRenewals } from './hello-renewals'
import type { ConnectionHost } from './host'
import { REASON } from './reasons'
import type { RegionSubscriptions } from './region-subscriptions'

export interface DeviceRequestsDeps {
  readonly sessions: Pick<IdentitySessions, 'exclusively' | 'parked' | 'renew' | 'unpark'>
  readonly devices: Pick<DeviceSessions, 'bind' | 'rotate' | 'signedOut' | 'revokeGrant'>
  readonly hub: Pick<RegionHub, 'subscribe' | 'pull' | 'push' | 'heads' | 'compact'>
  /** The gate a renewal of `device` asks before its refresh key is exchanged: the renewal limits. */
  readonly renewals: (device: string) => RenewalGate
  readonly clock: Clock
  /** Hears sign-outs; no line carries a token, a key or a grant id. */
  readonly log: Logger
}

export interface DeviceRequestsOptions {
  readonly host: ConnectionHost
  readonly subscriptions: RegionSubscriptions
  readonly seen: DeviceSeen
  /** Pairs renewed for the device that it cannot take: dropped or parked. */
  readonly pairs: HelloRenewals
}

export class DeviceRequests {
  readonly #sessions: DeviceRequestsDeps['sessions']
  readonly #devices: DeviceRequestsDeps['devices']
  readonly #hub: DeviceRequestsDeps['hub']
  readonly #renewalGate: DeviceRequestsDeps['renewals']
  readonly #clock: Clock
  readonly #log: Logger
  readonly #host: ConnectionHost
  readonly #subscriptions: RegionSubscriptions
  readonly #seen: DeviceSeen
  readonly #pairs: HelloRenewals

  constructor(deps: DeviceRequestsDeps, options: DeviceRequestsOptions) {
    this.#sessions = deps.sessions
    this.#devices = deps.devices
    this.#hub = deps.hub
    this.#renewalGate = deps.renewals
    this.#clock = deps.clock
    this.#log = deps.log
    this.#host = options.host
    this.#subscriptions = options.subscriptions
    this.#seen = options.seen
    this.#pairs = options.pairs
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
      .with({ type: 'renew' }, () => this.#renew(device))
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

  /**
   * The device asked for new keys over its channel (`renewOnChannel`), as its one key operation
   * under way: they are sent and held from then on; a renewal the limits refused is answered and
   * the channel kept, and the rest close as at hello. A socket a newer hello of the device took
   * over meanwhile spends nothing; one that closed meanwhile leaves the new pair parked for the
   * device's next hello with the spent key.
   */
  async #renew(device: ConnectedDevice): Promise<void> {
    await this.#sessions.exclusively(device.id, async () => {
      if (this.#host.isClosed()) {
        return
      }

      const spent = device.tokens.refresh
      // A hello of the device spent the key and could not hand over its pair: the pair is the
      // device's already, so no renewal is tried or counted.
      const parked =
        spent === undefined
          ? undefined
          : this.#sessions.parked({ device: device.id, refresh: spent })

      this.#answerRenewal(
        device,
        spent,
        parked
          ? { kind: 'deliver', tokens: parked.tokens }
          : await renewOnChannel(
              { sessions: this.#sessions, devices: this.#devices, renewals: this.#pairs },
              {
                identity: device.identity,
                device: device.id,
                tokens: device.tokens,
                renewal: this.#renewalGate(device.id),
              },
            ),
      )
    })
  }

  #answerRenewal(
    device: ConnectedDevice,
    spent: string | undefined,
    outcome: ChannelRenewal,
  ): void {
    if (outcome.kind === 'deliver') {
      const { tokens } = outcome

      // A socket that closed meanwhile, or that cannot take them, leaves the new keys parked.
      if (this.#host.sendTokens(device.identity.id, device.id, spent, tokens)) {
        // Read now: a change of memberships may have replaced the device's regions meanwhile.
        const current = this.#host.device()

        if (current !== undefined) {
          this.#host.ready({ ...current, tokens })
        }

        // The renewal marked the device seen as it moved the row to the new grant.
        this.#seen.renewed()
      }
    } else if (this.#host.isClosed()) {
      // Nobody is left to answer.
    } else if (outcome.kind === 'answer') {
      this.#host.send(outcome.message)
    } else if (outcome.kind === 'close') {
      this.#host.close(outcome.code, outcome.reason)
    } else {
      this.#host.fail(outcome.error)
    }
  }

  /** Leaves the device's regions, signs it out (`signOutOnChannel`) and closes as it answers. */
  async #signOut(device: ConnectedDevice): Promise<void> {
    this.#subscriptions.leaveAll()

    const close = await signOutOnChannel(
      { sessions: this.#sessions, devices: this.#devices, log: this.#log },
      { identity: device.identity.id, device: device.id, refresh: device.tokens.refresh },
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
