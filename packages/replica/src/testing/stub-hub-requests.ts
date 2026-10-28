import type { ClientMessage } from '../protocol'

import { type Connection, type DeviceRegion, type Gateway, settle } from './stub-state'

/** A message of the device of the given type. */
type Request<T extends ClientMessage['type']> = Extract<ClientMessage, { readonly type: T }>

/** The hub subscribes the device to a region it may name and answers with what the device lacks. */
export function subscribe(
  gateway: Gateway,
  connection: Connection,
  named: DeviceRegion | undefined,
  { vv }: Request<'subscribe'>,
): void {
  // The channel checked that the device may name the region.
  if (named) {
    connection.asked += 1
    settle(gateway, gateway.hub.subscribe(named.ref, named.actor, connection.subscriber, vv))
  }
}

/** The hub answers a pull, unless a test refuses the next one as the gateway refuses a device that is not subscribed. */
export function pull(
  gateway: Gateway,
  connection: Connection,
  { region, vv }: Request<'pull'>,
): void {
  connection.asked += 1

  if (gateway.refusePull) {
    gateway.refusePull = false
    connection.subscriber.send({
      type: 'error',
      code: 'protocol',
      message: `not subscribed to region ${region}`,
    })
  } else {
    settle(gateway, gateway.hub.pull(region, connection.subscriber, vv))
  }
}

/** The hub takes a push in, unless a test swallows the next one or rejects every batch. */
export function push(
  gateway: Gateway,
  connection: Connection,
  { region, batch, updates }: Request<'push'>,
): void {
  const swallowed = gateway.swallowPush

  if (swallowed) {
    gateway.swallowPush = undefined
    swallowed()
  } else if (gateway.rejectAll) {
    connection.subscriber.send({
      type: 'reject',
      region,
      batch,
      reason: 'foreign-table',
      detail: 'the test gateway rejects every batch',
    })
  } else {
    settle(gateway, gateway.hub.push(region, connection.subscriber, batch, updates))
  }
}

/** The hub takes a compaction proposal in. */
export function compact(
  gateway: Gateway,
  connection: Connection,
  { region, covers, snapshot }: Request<'compact'>,
): void {
  settle(gateway, gateway.hub.compact(region, connection.subscriber, covers, snapshot))
}

/** The hub answers a probe with the heads of the regions it names, unless a test swallows the next one. */
export function probe(
  gateway: Gateway,
  connection: Connection,
  { regions }: Request<'probe'>,
): void {
  const swallowed = gateway.swallowProbe

  if (swallowed) {
    gateway.swallowProbe = undefined
    swallowed()

    return
  }

  settle(
    gateway,
    gateway.hub.heads(regions).andTee((heads) =>
      connection.subscriber.send({
        type: 'heads',
        regions: [...heads],
        time: gateway.clock.now(),
      }),
    ),
  )
}
