import { ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { OrganisationLookup } from '../organisation-lookup'

/** Hears an identity's new memberships; the change it belongs to resolves once this does. */
export type MembershipListener = (
  identity: IdentityId,
  memberships: readonly Membership[],
) => Promise<void>

/** Who hears that an identity's memberships changed, and the telling of them. */
export class MembershipListeners {
  readonly #listeners = new Set<MembershipListener>()
  readonly #lookup: OrganisationLookup

  constructor(lookup: OrganisationLookup) {
    this.#lookup = lookup
  }

  /** Hears every change from now on, until the answered function is called. */
  add(listener: MembershipListener): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** Tells the listeners the memberships `identity` has now; resolves once each heard them. */
  tell(identity: IdentityId): ResultAsync<void, DataError> {
    return this.#lookup
      .membershipsOf(identity)
      .andThen((memberships) =>
        ResultAsync.fromPromise(
          Promise.all([...this.#listeners].map((listener) => listener(identity, memberships))),
          (cause) =>
            dataError('data:WRITE_FAILED', `could not tell the memberships of ${identity}`, cause),
        ).map(() => undefined),
      )
  }
}
