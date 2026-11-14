import type { Result, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { IdentityId, InvitationId } from '@workspace/ids'
import {
  type Ability,
  type AbilitySchema,
  defineAbilityFor,
  NO_ABILITY,
  type RuleViolation,
} from '@workspace/kernel'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import type {
  InvitationOnLink,
  InvitationsPort,
  ReceivedInvitation,
} from '../../../platform/invitations.port'
import type {
  InvitationView,
  MemberView,
  OrganisationsPort,
} from '../../../platform/organisations.port'
import type { SessionPort } from '../../../platform/session.port'
import { checkOrganisationName } from '../domain/organisation-name.rule'
import { checkTenantKey } from '../domain/tenant-key.rule'

/** What the service needs of the session: who is signed in, the memberships and the organisation chosen on this browser. */
export type OrganisationSession = Pick<
  SessionPort,
  'current' | 'memberships' | 'subscribeMemberships' | 'currentTenant' | 'selectTenant'
>

/** No memberships: one list, so a component that reads them sees no change while there are none. */
const NONE: readonly Membership[] = []

/** The value the domain accepts, or the first rule it breaks. */
function checked(
  result: Result<string, readonly RuleViolation[]>,
  fallback: string,
): Result<string, BusError> {
  return result.mapErr((violations) => ({
    code: violations[0]?.code ?? fallback,
    causes: violations,
  }))
}

/** A refusal of the gateway fails with the gateway's code (`key-taken`, `not-admin`, …); any other failure with its own. */
function failure(error: DataError): BusError {
  return error.code === 'data:WRITE_REJECTED'
    ? { code: error.message, message: `the gateway refused: ${error.message}` }
    : { code: error.code, message: error.message }
}

/**
 * The organisations of the signed-in identity: those it belongs to, the current one, and what
 * the gateway does for them: creating one, listing, inviting and removing its members, changing
 * a member's role, and the invitations (an admin's to an organisation, an account's received).
 */
export class OrganisationService {
  constructor(
    private readonly session: OrganisationSession,
    private readonly organisations: OrganisationsPort,
    private readonly invitationPort: InvitationsPort,
    private readonly schema: AbilitySchema,
  ) {}

  memberships(): readonly Membership[] {
    const memberships = this.session.memberships()

    return memberships.length === 0 ? NONE : memberships
  }

  /** Hears the memberships or the current organisation change. */
  subscribe(listener: () => void): () => void {
    return this.session.subscribeMemberships(listener)
  }

  current(): Membership | undefined {
    return this.session.currentTenant()
  }

  /** What the signed-in member may do in the current organisation; nothing without one. */
  ability(): Ability {
    const user = this.session.current()
    const current = this.session.currentTenant()

    return user && current
      ? defineAbilityFor({ id: user.id, role: current.role }, this.schema)
      : NO_ABILITY
  }

  select(key: string): void {
    this.session.selectTenant(key)
  }

  /** Creates an organisation the identity administers and makes it the current one. */
  create(input: {
    readonly key: string
    readonly name: string
  }): ResultAsync<Membership, BusError> {
    return checked(checkTenantKey(input.key), 'organisation:KEY_INVALID')
      .andThen((key) =>
        checked(checkOrganisationName(input.name), 'organisation:NAME_INVALID').map((name) => ({
          key,
          name,
        })),
      )
      .asyncAndThen((valid) => this.organisations.create(valid).mapErr(failure))
      .map((membership) => {
        this.session.selectTenant(membership.tenant.key)

        return membership
      })
  }

  members(key: string): ResultAsync<readonly MemberView[], BusError> {
    return this.organisations.members(key).mapErr(failure)
  }

  /** Invites an email (whether it has an account or not) with the role its account takes on accepting. */
  invite(key: string, email: string, role: TenantRole): ResultAsync<InvitationView, BusError> {
    return this.organisations.invite(key, email.trim(), role).mapErr(failure)
  }

  /** The pending invitations of an organisation, newest first. */
  invitations(key: string): ResultAsync<readonly InvitationView[], BusError> {
    return this.organisations.invitations(key).mapErr(failure)
  }

  /** Revokes a pending invitation: its link stops working. */
  revokeInvitation(key: string, invitation: InvitationId): ResultAsync<void, BusError> {
    return this.organisations.revokeInvitation(key, invitation).mapErr(failure)
  }

  /**
   * Changes a member's role. Nothing is adopted here: every device of the member, this one's
   * included, learns the role from the gateway over the channel.
   */
  setRole(key: string, identity: IdentityId, role: TenantRole): ResultAsync<void, BusError> {
    return this.organisations.setRole(key, identity, role).mapErr(failure)
  }

  remove(key: string, identity: IdentityId): ResultAsync<void, BusError> {
    return this.organisations.remove(key, identity).mapErr(failure)
  }

  /** What the link of an invitation shows, for the account signed in on this device or nobody. */
  readInvitation(token: string): ResultAsync<InvitationOnLink, BusError> {
    return this.invitationPort.read(token).mapErr(failure)
  }

  /** The invitations to the signed-in account that it is not a member of yet, newest first. */
  received(): ResultAsync<readonly ReceivedInvitation[], BusError> {
    return this.invitationPort.mine().mapErr(failure)
  }

  /**
   * Accepts an invitation (its id, or the token of its link): the account is a member of its
   * organisation on this device once the answer comes, and that organisation becomes the
   * current one.
   */
  accept(invitation: string): ResultAsync<Membership, BusError> {
    return this.invitationPort
      .accept(invitation)
      .mapErr(failure)
      .map((membership) => {
        this.session.selectTenant(membership.tenant.key)

        return membership
      })
  }

  /** Declines an invitation (its id, or the token of its link): its link stops working. */
  decline(invitation: string): ResultAsync<void, BusError> {
    return this.invitationPort.decline(invitation).mapErr(failure)
  }
}

export const ORGANISATION_SERVICE = token<OrganisationService>('OrganisationService')
