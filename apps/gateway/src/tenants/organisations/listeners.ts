import { err, ok, type Result, ResultAsync } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { OrganisationLookup } from '../organisation-lookup'

import { MembershipRetells, type RetellOptions } from './retells'
import type { MembershipTurns } from './turns'

/** Hears an identity's new memberships; the change it belongs to resolves once this settled. */
export type MembershipListener = (
  identity: IdentityId,
  memberships: readonly Membership[],
) => Promise<void>

/**
 * Who hears that an identity's memberships changed, and the telling of them. A tell reads the
 * identity's memberships and runs every listener, waiting for all of them to settle, so the
 * identity's turn is never released while an older list is still being published. A tell that
 * fails, at the read or at a listener, fails no change: it is handed to the re-tells
 * (`MembershipRetells`), which log it and tell the identity again later, in its turn, with the
 * memberships read afresh then.
 */
export class MembershipListeners {
  readonly #listeners = new Set<MembershipListener>()
  readonly #lookup: OrganisationLookup
  readonly #retells: MembershipRetells

  constructor(lookup: OrganisationLookup, turns: MembershipTurns, retell: RetellOptions) {
    this.#lookup = lookup
    this.#retells = new MembershipRetells({
      ...retell,
      turns,
      attempt: (identity) => this.#attempt(identity),
    })
  }

  /** Hears every change from now on, until the answered function is called. */
  add(listener: MembershipListener): () => void {
    this.#listeners.add(listener)

    return () => {
      this.#listeners.delete(listener)
    }
  }

  /**
   * Tells the listeners the memberships `identity` has now, inside the identity's turn: resolves
   * once every one of them settled, and never fails, a failure being retold later.
   */
  tell(identity: IdentityId): ResultAsync<void, never> {
    const told = async (): Promise<Result<void, never>> => {
      const outcome = await this.#attempt(identity)

      this.#retells.settled(identity, outcome)

      return ok(undefined)
    }

    return new ResultAsync(told())
  }

  /** Stops the re-tells for good; resolves once the one running, if any, settled. */
  close(): Promise<void> {
    return this.#retells.close()
  }

  /**
   * One try at telling: the memberships read, every listener run and waited for, the read's
   * failure or the first listener's (a synchronous throw counting as a rejection) answering.
   */
  #attempt(identity: IdentityId): ResultAsync<void, DataError> {
    return this.#lookup.membershipsOf(identity).andThen((memberships) =>
      ResultAsync.fromSafePromise(
        Promise.allSettled(
          [...this.#listeners].map((listener) =>
            Promise.resolve().then(() => listener(identity, memberships)),
          ),
        ),
      ).andThen((settled) => {
        const failed = settled.find(
          (outcome): outcome is PromiseRejectedResult => outcome.status === 'rejected',
        )

        return failed === undefined
          ? ok(undefined)
          : err(
              dataError(
                'data:WRITE_FAILED',
                `could not tell the memberships of ${identity}`,
                failed.reason,
              ),
            )
      }),
    )
  }
}
