import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

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
   * The identity's role in the organisation of `region` is now `role`: the device's next pushes
   * there are judged by it at once, whatever it is doing, the ones it has queued already
   * included. Nothing is sent: the memberships follow. Resolves once that holds; never rejects.
   */
  rerole(region: string, role: TenantRole): Promise<void>
  /**
   * The device was signed out, from another device or over one of its sockets, or signed in
   * again into a new session: its socket closes with `code` at once, whatever it is doing.
   * Resolves once it closed.
   */
  end(code: number): Promise<void>
  /**
   * Another connection of the device took over: the socket closes at once, without signing the
   * device out; the device connects again after such a close.
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
 * memberships reaches every device it has connected, and a device signed out from another one,
 * or signed in again, is closed wherever it is connected. Each close moves the registry's
 * revocation epoch and records it against the device, or the whole identity, it names. A hello
 * reads the epoch before it reads its session, when it knows neither the identity nor whether
 * the device is signed in, and registers with it: a close of the device or of its identity that
 * lands from then on, while the session is read, refuses the registration, and one before it is
 * seen by the read (the routes, and a sign-in, end the session before they close the sockets). A
 * device holds one live connection: the one a newer hello registers closes the older ones
 * (`supersede`).
 */
export class ConnectionRegistry {
  readonly #onFailure: (error: DataError) => void
  readonly #byIdentity = new Map<IdentityId, Set<Entry>>()
  /** How many closes the registry made. */
  #epoch = 0
  /** The epoch of the last close of every device of an identity. */
  readonly #identityClosedAt = new Map<IdentityId, number>()
  /** The epoch of the last close of each device of an identity, by identity and device. */
  readonly #deviceClosedAt = new Map<string, number>()

  constructor(options: ConnectionRegistryOptions) {
    this.#onFailure = options.onFailure
  }

  /** The revocation epoch: it moves with each close, whatever it names. */
  epoch(): number {
    return this.#epoch
  }

  /**
   * Registers a connection of `device` of `identity`, whose hello read `epoch`; the answer
   * removes it again, once. A device closed since that epoch was read, alone or with every device
   * of its identity, is not registered: `undefined`.
   */
  add(
    identity: IdentityId,
    device: string,
    connection: MembershipsListener,
    epoch: number,
  ): (() => void) | undefined {
    if (
      (this.#identityClosedAt.get(identity) ?? 0) > epoch ||
      (this.#deviceClosedAt.get(deviceKey(identity, device)) ?? 0) > epoch
    ) {
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
   * up that the gateway still holds) is served no more. It signs nothing out: no epoch moves.
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
   * Judges the pushes of every live connection of `identity` into `region` by `role` from now
   * on; resolves once each does.
   */
  async rerole(identity: IdentityId, region: string, role: TenantRole): Promise<void> {
    await Promise.all(this.forIdentity(identity).map((each) => each.rerole(region, role)))
  }

  /**
   * Closes with `code` every live connection of `device` of `identity`, or of every device of
   * the identity when `device` is undefined, and moves the epoch, recorded against what it names;
   * resolves once each closed. A connection that fails to close is reported and the others are
   * closed all the same. Never rejects.
   */
  async close(identity: IdentityId, device: string | undefined, code: number): Promise<void> {
    this.#epoch += 1

    if (device === undefined) {
      this.#identityClosedAt.set(identity, this.#epoch)
    } else {
      this.#deviceClosedAt.set(deviceKey(identity, device), this.#epoch)
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

/** The key of a device of an identity in the map of its closes. */
function deviceKey(identity: IdentityId, device: string): string {
  return `${identity}\u0000${device}`
}
