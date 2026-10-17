import type { Result, ResultAsync } from 'neverthrow'

import type { BusError } from '@workspace/cqrs'
import type { DataError } from '@workspace/data'
import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'
import type { RuleViolation } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'

import type { MemberView, OrganisationsPort } from '../../../platform/organisations.port'
import type { SessionPort } from '../../../platform/session.port'
import { checkOrganisationName, checkTenantKey } from '../domain/organisation.entity'

/** What the service needs of the session: the memberships and the organisation chosen on this browser. */
export type OrganisationSession = Pick<
  SessionPort,
  'memberships' | 'subscribeMemberships' | 'currentTenant' | 'selectTenant'
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
 * the gateway does for them: creating one, and listing, inviting and removing its members.
 */
export class OrganisationService {
  constructor(
    private readonly session: OrganisationSession,
    private readonly organisations: OrganisationsPort,
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

  invite(key: string, email: string): ResultAsync<MemberView, BusError> {
    return this.organisations.invite(key, email.trim()).mapErr(failure)
  }

  remove(key: string, identity: IdentityId): ResultAsync<void, BusError> {
    return this.organisations.remove(key, identity).mapErr(failure)
  }
}

export const ORGANISATION_SERVICE = token<OrganisationService>('OrganisationService')
