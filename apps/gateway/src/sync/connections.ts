import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

/** A device's open connection, as far as its identity's memberships and sessions go. */
export interface MembershipsListener {
  /**
   * The identity's memberships are now `next`: the device may name only their regions from now
   * on. Resolves once the device was sent them; never rejects.
   */
  memberships(next: readonly Membership[]): Promise<void>
  /**
   * The identity left the organisation of `region`: the device may no longer name it and leaves
   * it at once, whatever it is doing. Resolves once that holds; never rejects.
   */
  revoke(region: string): Promise<void>
  /**
   * The device was signed out from another device: its socket closes with `code` at once,
   * whatever it is doing. Resolves once it closed.
   */
  end(code: number): Promise<void>
  /**
   * Another connection of the device took over: the socket closes at once, without signing the
   * device out, and spends no key any more; the device connects again after such a close.
   */
  supersede(): void
}

export interface ConnectionRegistryOptions {
  /** Hears a connection that failed to close; the other connections are closed all the same. */
  readonly onFailure: (error: DataError) => void
}

/** A registered connection, with the identity and the device it belongs to. */
interface Entry {
  readonly identity: IdentityId
  readonly device: string
  readonly connection: MembershipsListener
}

/**
 * The open sync connections of each identity and device, so a change of an identity's
 * memberships reaches every device it has connected, and a device signed out from another one
 * is closed wherever it is connected. Each close moves a revocation epoch, of the device or of the
 * whole identity: a hello reads the epoch once its keys are accepted and registers with it, so a
 * close that lands while the hello reads the device's row refuses the registration. A device holds
 * one live connection: the one a newer hello registers closes the older ones (`supersede`).
 */
export class ConnectionRegistry {
  readonly #onFailure: (error: DataError) => void
  readonly #byIdentity = new Map<IdentityId, Set<Entry>>()
  /** How many times every device of an identity was closed. */
  readonly #identityEpochs = new Map<IdentityId, number>()
  /** How many times each device of an identity was closed, by identity and device. */
  readonly #deviceEpochs = new Map<string, number>()

  constructor(options: ConnectionRegistryOptions) {
    this.#onFailure = options.onFailure
  }

  /** The revocation epoch of `device` of `identity`: it moves with each close that names it. */
  epoch(identity: IdentityId, device: string): number {
    return (
      (this.#identityEpochs.get(identity) ?? 0) +
      (this.#deviceEpochs.get(deviceKey(identity, device)) ?? 0)
    )
  }

  /**
   * Registers a connection of `device` of `identity`, whose hello read `epoch`; the answer
   * removes it again, once. A device closed since that epoch was read is not registered:
   * `undefined`.
   */
  add(
    identity: IdentityId,
    device: string,
    connection: MembershipsListener,
    epoch: number,
  ): (() => void) | undefined {
    if (epoch !== this.epoch(identity, device)) {
      return undefined
    }

    const entries = this.#byIdentity.get(identity) ?? new Set()
    const entry: Entry = { identity, device, connection }

    entries.add(entry)
    this.#byIdentity.set(identity, entries)

    return () => {
      entries.delete(entry)

      if (entries.size === 0 && this.#byIdentity.get(identity) === entries) {
        this.#byIdentity.delete(identity)
      }
    }
  }

  /**
   * Closes every live connection of `device` of `identity` but `keep`, which a newer hello of the
   * device registered: a device holds one live socket, so an older one (a socket the device gave
   * up that the gateway still holds) spends none of its keys. It signs nothing out: no epoch moves.
   */
  supersede(identity: IdentityId, device: string, keep: MembershipsListener): void {
    for (const entry of this.#entriesOf(identity)) {
      if (entry.device === device && entry.connection !== keep) {
        entry.connection.supersede()
      }
    }
  }

  /** The connections of `identity` registered and not removed. */
  forIdentity(identity: IdentityId): readonly MembershipsListener[] {
    return this.#entriesOf(identity).map((entry) => entry.connection)
  }

  /** Tells every live connection of `identity` its memberships; resolves once each was told. */
  async tell(identity: IdentityId, memberships: readonly Membership[]): Promise<void> {
    await Promise.all(this.forIdentity(identity).map((each) => each.memberships(memberships)))
  }

  /**
   * Takes `region` from every live connection of `identity` at once; resolves once none of them
   * may name it any more.
   */
  async revoke(identity: IdentityId, region: string): Promise<void> {
    await Promise.all(this.forIdentity(identity).map((each) => each.revoke(region)))
  }

  /**
   * Closes with `code` every live connection of `device` of `identity`, or of every device of
   * the identity when `device` is undefined, and moves the epoch of what it names; resolves once
   * each closed. A connection that fails to close is reported and the others are closed all the
   * same. Never rejects.
   */
  async close(identity: IdentityId, device: string | undefined, code: number): Promise<void> {
    if (device === undefined) {
      this.#identityEpochs.set(identity, (this.#identityEpochs.get(identity) ?? 0) + 1)
    } else {
      const key = deviceKey(identity, device)

      this.#deviceEpochs.set(key, (this.#deviceEpochs.get(key) ?? 0) + 1)
    }

    await Promise.all(
      this.#entriesOf(identity)
        .filter((entry) => device === undefined || entry.device === device)
        .map((entry) => this.#end(entry, code)),
    )
  }

  async #end(entry: Entry, code: number): Promise<void> {
    try {
      await entry.connection.end(code)
    } catch (cause) {
      this.#onFailure(
        dataError('data:WRITE_FAILED', `could not close a connection of ${entry.identity}`, cause),
      )
    }
  }

  #entriesOf(identity: IdentityId): readonly Entry[] {
    return [...(this.#byIdentity.get(identity) ?? [])]
  }
}

/** The key of a device of an identity in the map of epochs. */
function deviceKey(identity: IdentityId, device: string): string {
  return `${identity}\u0000${device}`
}
