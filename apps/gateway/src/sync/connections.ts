import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

/** A device's open connection, as far as a change of its identity's memberships goes. */
export interface MembershipsListener {
  memberships(next: readonly Membership[]): void
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
}
