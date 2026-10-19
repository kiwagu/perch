import type { Result, ResultAsync } from 'neverthrow'

import { type DataError, tenantRegionId } from '@workspace/data'
import { type Ability, defineAbilityFor, NO_ABILITY, OWNER_ABILITY } from '@workspace/kernel'

import type { Clock } from '../clock'
import {
  type ClientMessage,
  type CompactionOutcome,
  clientMessage,
  decodeMessage,
  encodeMessage,
  type Membership,
  type ProtocolError,
  type ServerMessage,
  serverMessage,
} from '../protocol'
import type { RegionRef } from '../region-doc'
import { identityRegions } from '../region-ref'
import type { ReplicaSchema } from '../schema'
import type { Actor, RegionHub, Subscriber } from '../server/region-hub'
import type { SyncTransport } from '../sync/transport'

/** A device's channel to the stub, which the test can take offline and bring back. */
export interface StubTransport extends SyncTransport {
  /** The connection drops: the channel goes down and messages are lost both ways. */
  goOffline(): void
  /** The device connects again, as a reconnect would: a new welcome follows. */
  goOnline(): void
  /** Started, not offline and not signed out: the channel is meant to be up. */
  online(): boolean
  /** How many times the engine gave a connection up with `reconnect`. */
  reconnects(): number
}

export interface CompactionAnswer {
  readonly covers: number
  readonly outcome: CompactionOutcome
}

/** What every device channel of one stub shares. */
export interface Gateway {
  readonly hub: RegionHub
  readonly schema: ReplicaSchema
  readonly clock: Clock
  readonly memberships: readonly Membership[]
  readonly failures: DataError[]
  readonly compactions: CompactionAnswer[]
  rejections: number
  signOuts: number
  rejectAll: boolean
  /** Set while the next push is to go unanswered: called when it arrives. */
  swallowPush: (() => void) | undefined
  /** Set while the next probe is to go unanswered: called when it arrives. */
  swallowProbe: (() => void) | undefined
  refusePull: boolean
  /** Set while the next sign-out is to leave the channel open: called when it arrives. */
  keepOpen: (() => void) | undefined
  /** Set while the next sign-out is to fail its revoke: called when it arrives. */
  failSignOut: (() => void) | undefined
  /** The keys the next device to connect is handed before its welcome. */
  renewal: { readonly access: string; readonly refresh: string } | undefined
}

/** A region the device may name, and who it subscribes there as. */
export interface DeviceRegion {
  readonly ref: RegionRef
  readonly actor: Actor
}

/** One connection of a device: its end at the hub, up once welcomed. */
export interface Connection {
  readonly subscriber: Subscriber
  up: boolean
  /** The device asked to be signed out on it: nothing it sends after is handled. */
  signedOut: boolean
  /** Subscriptions and pulls sent on it that wait for their updates. */
  asked: number
}

/** A message the protocol refuses here was built wrong by the engine or the hub. */
function crossed<T>(decoded: Result<T, ProtocolError>, type: string): T {
  if (decoded.isErr()) {
    throw new Error(`the protocol refuses a ${type} message: ${decoded.error.message}`)
  }

  return decoded.value
}

/** A device's message as the gateway reads it: encoded, then decoded. */
export function sentByDevice(message: ClientMessage): ClientMessage {
  return crossed(decodeMessage(clientMessage, encodeMessage(clientMessage, message)), message.type)
}

/** A gateway's message as the device reads it: encoded, then decoded. */
export function sentToDevice(message: ServerMessage): ServerMessage {
  return crossed(decodeMessage(serverMessage, encodeMessage(serverMessage, message)), message.type)
}

/**
 * The regions a device of `identity` may name, by id, and who it subscribes there as: the
 * identity's private region, where it is the owner, and the region of each of the stub's
 * memberships, where it may do what the membership's role allows.
 */
export function deviceRegions(
  gateway: Gateway,
  identity: string,
): ReadonlyMap<string, DeviceRegion> {
  const roles = new Map(
    gateway.memberships.map(({ tenant, role }) => [tenantRegionId(tenant.key), role]),
  )

  return new Map(
    identityRegions(identity, gateway.memberships).map((ref) => {
      const role = roles.get(ref.id)
      // As the gateway does: only the private region is the identity's own.
      const ability: Ability =
        ref.kind === 'private'
          ? OWNER_ABILITY
          : role === undefined
            ? NO_ABILITY
            : defineAbilityFor({ id: identity, role }, gateway.schema)

      return [ref.id, { ref, actor: { id: identity, ability } }]
    }),
  )
}

/** The hub answers the device itself; a call that fails all the same is recorded. */
export function settle(gateway: Gateway, call: ResultAsync<unknown, DataError>): void {
  void call.match(
    () => {},
    (error) => {
      gateway.failures.push(error)
    },
  )
}
