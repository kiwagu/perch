import { ResultAsync } from 'neverthrow'

import type { IdentityId } from '@workspace/ids'

import { KeyedTurns } from '../../keyed-turns'

/**
 * The order of the changes of memberships. Each change runs in the turn of the identity whose
 * memberships it changes, so one identity's changes settle one after the other. A change that
 * writes an organisation's memberships, or decides from who else belongs to it, runs inside
 * that in the turn of each organisation it touches, so two changes of different identities in
 * one organisation never decide from the same rows. An identity's turn is always taken before
 * an organisation's and never while one is held, and several organisations' turns in the order
 * of their ids, so no two changes wait for each other. Each turn starts once the one asked
 * before it under the same key has settled, whatever its outcome. This orders the changes
 * within one gateway process only.
 */
export class MembershipTurns {
  readonly #identities = new KeyedTurns<IdentityId>()
  readonly #tenants = new KeyedTurns<string>()

  /** Runs `work` once the changes of `identity` asked before it have settled. */
  ofIdentity<T, E>(identity: IdentityId, work: () => ResultAsync<T, E>): ResultAsync<T, E> {
    return new ResultAsync(this.#identities.run(identity, work))
  }

  /**
   * Runs `work` holding the turns of the organisations whose ids `tenants` names, taken one after
   * the other in the order of their ids; asked from inside an identity's turn.
   */
  ofTenants<T, E>(tenants: readonly string[], work: () => ResultAsync<T, E>): ResultAsync<T, E> {
    const held = [...new Set(tenants)]
      .sort()
      .reduceRight<() => ResultAsync<T, E>>(
        (inner, tenant) => () => new ResultAsync(this.#tenants.run(tenant, inner)),
        work,
      )

    return held()
  }
}
