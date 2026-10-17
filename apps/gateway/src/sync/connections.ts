import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

/** A device's open connection, as far as its identity's memberships go. */
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
}

/**
 * The open sync connections of each identity, so a change of an identity's memberships
 * reaches every device it has connected.
 */
export class ConnectionRegistry {
  readonly #byIdentity = new Map<IdentityId, Set<MembershipsListener>>()

  /** Registers a connection of `identity`; the answer removes it again, once. */
  add(identity: IdentityId, connection: MembershipsListener): () => void {
    const connections = this.#byIdentity.get(identity) ?? new Set()

    connections.add(connection)
    this.#byIdentity.set(identity, connections)

    return () => {
      connections.delete(connection)

      if (connections.size === 0 && this.#byIdentity.get(identity) === connections) {
        this.#byIdentity.delete(identity)
      }
    }
  }

  /** The connections of `identity` registered and not removed. */
  forIdentity(identity: IdentityId): readonly MembershipsListener[] {
    return [...(this.#byIdentity.get(identity) ?? [])]
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
}
