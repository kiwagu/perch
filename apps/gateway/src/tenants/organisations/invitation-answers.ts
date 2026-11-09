import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { type IdentityId, type InvitationId, idSchemas } from '@workspace/ids'
import type { Membership } from '@workspace/replica/protocol'

import type { PendingInvitation, PendingInvitations } from '../invitations'
import type { OrganisationLookup } from '../organisation-lookup'
import {
  type OrganisationError,
  type OrganisationRefusalCode,
  refused,
} from '../organisation-refusal'

import type { OrganisationAdmission } from './admission'
import type { MembershipListeners } from './listeners'
import type { MembershipTurns } from './turns'

export interface InvitationAnswersOptions {
  readonly lookup: OrganisationLookup
  readonly turns: MembershipTurns
  readonly admission: OrganisationAdmission
  readonly listeners: MembershipListeners
  readonly pending: PendingInvitations
}

/**
 * The answers the invited account gives an invitation: it accepts and becomes a member, or
 * declines and the invitation is spent. The invitation is bound to its email: only the account
 * whose directory email is the row's may answer it, however it names it (its id, or its link's
 * token; the invitation id schema alone tells them apart), and an invitation replaced, revoked,
 * declined, accepted or expired meanwhile is `invitation-gone`. Each answer decides from the rows
 * as they are in the organisation's turn, ordered with the invites, revocations, removals and
 * departures of the organisation. An accept that fails before the directory's transaction leaves
 * its invitation live, and asking again completes it; one whose telling fails leaves the
 * membership made and the invitation spent.
 */
export class InvitationAnswers {
  readonly #lookup: OrganisationLookup
  readonly #turns: MembershipTurns
  readonly #admission: OrganisationAdmission
  readonly #listeners: MembershipListeners
  readonly #pending: PendingInvitations

  constructor(options: InvitationAnswersOptions) {
    this.#lookup = options.lookup
    this.#turns = options.turns
    this.#admission = options.admission
    this.#listeners = options.listeners
    this.#pending = options.pending
  }

  /**
   * `identity` accepts the invitation `invitation` names, an id or a link's token: in its turn and
   * the organisation's it becomes a member with the role of the invitation, and its listeners
   * hear it. Refused `invitation-gone` for an invitation that is gone, expired or of an
   * organisation not ready (a spent link never readmits), `no-such-identity` when its account is
   * gone, `other-account` when its email is not the invitation's and `already-member` when it
   * belongs to the organisation already (the invitation stays).
   */
  accept(input: {
    identity: IdentityId
    invitation: string
  }): ResultAsync<Membership, OrganisationError> {
    const { identity, invitation } = input

    return this.#turns.ofIdentity(identity, () =>
      this.#located(invitation).andThen((found) =>
        this.#turns.ofTenants([found.tenant.id], () =>
          this.#claimed(identity, found.id).andThen(({ id, role, tenant }) =>
            this.#admission
              .accept(tenant, identity, { id, role })
              .andThen(() => this.#listeners.tell(identity))
              .map(
                (): Membership => ({
                  tenant: { id: tenant.id, key: tenant.key, name: tenant.name },
                  role,
                }),
              ),
          ),
        ),
      ),
    )
  }

  /**
   * `identity` declines the invitation `invitation` names, in the organisation's turn: the row is
   * deleted and nobody is told. Refused as an accept is, but for `already-member`.
   */
  decline(input: {
    identity: IdentityId
    invitation: string
  }): ResultAsync<void, OrganisationError> {
    const { identity, invitation } = input

    return this.#located(invitation).andThen((found) =>
      this.#turns.ofTenants([found.tenant.id], () =>
        this.#claimed(identity, found.id)
          .andThen((current) => this.#pending.remove(current.id))
          .map(() => undefined),
      ),
    )
  }

  /**
   * The invitation `value` names, before any turn: an id when the invitation id schema takes it,
   * a link's token otherwise; one that is gone, expired or unreadable is `invitation-gone`.
   */
  #located(value: string): ResultAsync<PendingInvitation, OrganisationError> {
    const id = idSchemas.invitation.schema.safeParse(value)
    const found: ResultAsync<PendingInvitation | undefined, DataError> = id.success
      ? this.#pending.byId(id.data)
      : this.#pending
          .read(value)
          .map((read) => (read.kind === 'invitation' ? read.invitation : undefined))

    return found.andThen(present)
  }

  /**
   * The invitation `id` as it is in the organisation's turn, for `identity` to accept or decline:
   * read again (gone or expired is `invitation-gone`), then `identity` read again (an account that
   * is gone is `no-such-identity`), its directory email against the row's (`other-account`), and
   * the organisation ready (else `invitation-gone`).
   */
  #claimed(
    identity: IdentityId,
    id: InvitationId,
  ): ResultAsync<PendingInvitation, OrganisationError> {
    return this.#pending
      .byId(id)
      .andThen(present)
      .andThen((row) =>
        this.#lookup.emailOf(identity).andThen((email) => {
          if (email === undefined) {
            return refusing<PendingInvitation>('no-such-identity')
          }

          if (email.toLowerCase() !== row.email) {
            return refusing<PendingInvitation>('other-account')
          }

          return row.tenant.ready ? okAsync<PendingInvitation, OrganisationError>(row) : gone()
        }),
      )
  }
}

/** A refusal with `code`, for the result of type `T` that could not be made. */
function refusing<T = void>(code: OrganisationRefusalCode): ResultAsync<T, OrganisationError> {
  return errAsync(refused(code))
}

/** The refusal of an invitation that is no more. */
function gone(): ResultAsync<PendingInvitation, OrganisationError> {
  return refusing('invitation-gone')
}

/** The invitation found, or `invitation-gone` when there is none. */
function present(
  row: PendingInvitation | undefined,
): ResultAsync<PendingInvitation, OrganisationError> {
  return row === undefined ? gone() : okAsync(row)
}
