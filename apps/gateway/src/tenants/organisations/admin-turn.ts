import { errAsync, type ResultAsync } from 'neverthrow'

import type { IdentityId } from '@workspace/ids'

import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'
import type { Tenant } from '../organisation-rows'

import type { MembershipTurns } from './turns'

/**
 * The turn of an organisation held for a change one of its admins asked: the change decides from
 * the rows as they are in that turn, once the organisation proved to be the one asked of and the
 * asker still one of its admins.
 */
export class AdminTurn {
  readonly #turns: MembershipTurns
  readonly #lookup: OrganisationLookup

  constructor(turns: MembershipTurns, lookup: OrganisationLookup) {
    this.#turns = turns
    this.#lookup = lookup
  }

  /**
   * Runs `work`, a change of the organisation's memberships `actor` asked, in the organisation's
   * turn, once it found that the organisation is still the one asked of and `actor` still one of
   * its admins: a change that settled meanwhile (a departure that took the organisation whole,
   * or `actor` out of it) refuses it as the checks before the turn would have.
   */
  run<T>(
    actor: IdentityId,
    tenant: Tenant,
    work: (tenant: Tenant) => ResultAsync<T, OrganisationError>,
  ): ResultAsync<T, OrganisationError> {
    return this.#turns.ofTenants([tenant.id], () =>
      this.#lookup
        .tenantOf(tenant.key)
        .andThen((current) =>
          current.id === tenant.id
            ? this.#lookup.adminOf(actor, current)
            : errAsync(refused('no-such-tenant')),
        )
        .andThen(work),
    )
  }
}
