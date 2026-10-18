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
   * whatever it is doing. Resolves once it closed; never rejects.
   */
  end(code: number): Promise<void>
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
 * is closed wherever it is connected.
 */
export class ConnectionRegistry {
  readonly #byIdentity = new Map<IdentityId, Set<Entry>>()

  /** Registers a connection of `device` of `identity`; the answer removes it again, once. */
  add(identity: IdentityId, device: string, connection: MembershipsListener): () => void {
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
   * the identity when `device` is undefined; resolves once each closed.
   */
  async close(identity: IdentityId, device: string | undefined, code: number): Promise<void> {
    await Promise.all(
      this.#entriesOf(identity)
        .filter((entry) => device === undefined || entry.device === device)
        .map((entry) => entry.connection.end(code)),
    )
  }

  #entriesOf(identity: IdentityId): readonly Entry[] {
    return [...(this.#byIdentity.get(identity) ?? [])]
  }
}
