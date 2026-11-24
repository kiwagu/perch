import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import type { IdentityId, InvitationId } from '@workspace/ids'
import type { Membership, TenantRole } from '@workspace/replica/protocol'

import type {
  InvitationMailer,
  PendingInvitation,
  PendingInvitations,
  ReceivedInvitation,
} from '../invitations'
import type { OrganisationLookup } from '../organisation-lookup'
import { type OrganisationError, refused } from '../organisation-refusal'

import type { AdminTurn } from './admin-turn'
import { InvitationAnswers } from './invitation-answers'
import type { InvitationOnLink, InvitationView } from './invitation-views'
import type { OrganisationInvitationsOptions } from './options'

/**
 * The invitations of organisations: an admin invites an email (with an account or not) to join
 * with a role, lists the invitations and revokes them; the link the mail carries shows what it
 * offers; the account with that email accepts or declines it (`InvitationAnswers`). The
 * invitation is the row of `PendingInvitations`, one per organisation and email, bound to the
 * email: no answer of the link tells it, and only the account whose directory email it is may
 * answer the invitation. An invite and a revocation run in the organisation's turn and decide
 * there from the rows as they are then, ordered with the removals, the departures and the
 * answers of the organisation's invitations.
 */
export class OrganisationInvitations {
  readonly #lookup: OrganisationLookup
  readonly #adminTurn: AdminTurn
  readonly #pending: PendingInvitations
  readonly #mailer: InvitationMailer
  readonly #link: (token: string) => string
  readonly #answers: InvitationAnswers

  constructor(options: OrganisationInvitationsOptions) {
    this.#lookup = options.lookup
    this.#adminTurn = options.adminTurn
    this.#pending = options.pending
    this.#mailer = options.mailer
    this.#link = options.link
    this.#answers = new InvitationAnswers(options)
  }

  /**
   * An admin of the organisation invites `email` to join it with `role`: the email's pending
   * invitation to it, if any, is replaced (its link then names nothing), and the mail is started,
   * not awaited and never failing the call. An email a member of the organisation has, in any
   * case, is refused `already-member`; whether it has an account at all changes neither the answer
   * nor the work before it.
   */
  invite(input: {
    actor: IdentityId
    key: string
    email: string
    role: TenantRole
  }): ResultAsync<InvitationView, OrganisationError> {
    const { actor, key, role } = input
    const email = input.email.toLowerCase()

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) =>
        this.#adminTurn.run(actor, tenant, (current) =>
          this.#lookup
            .roleByEmail(current, email)
            .andThen((held) =>
              held === undefined
                ? okAsync<void, OrganisationError>(undefined)
                : errAsync<void, OrganisationError>(refused('already-member')),
            )
            .andThen(() => this.#pending.replace({ tenant: current, email, role, inviter: actor }))
            .map((invitation) => {
              this.#mailer.invite({
                email: invitation.email,
                organisation: current.name,
                role: invitation.role,
                token: invitation.token,
                inviter: actor,
              })

              return this.#view(invitation)
            }),
        ),
      )
  }

  /** The invitations of the organisation not expired, newest first, for its admins. */
  pending(input: {
    actor: IdentityId
    key: string
  }): ResultAsync<readonly InvitationView[], OrganisationError> {
    const { actor, key } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) => this.#pending.ofTenant(tenant))
      .map((invitations) => invitations.map((invitation) => this.#view(invitation)))
  }

  /**
   * An admin of the organisation revokes one of its invitations, in the organisation's turn. An
   * invitation of another organisation, or one that is gone, is no failure and deletes nothing.
   */
  revoke(input: {
    actor: IdentityId
    key: string
    invitation: InvitationId
  }): ResultAsync<void, OrganisationError> {
    const { actor, key, invitation } = input

    return this.#lookup
      .tenantOf(key)
      .andThen((tenant) => this.#lookup.adminOf(actor, tenant))
      .andThen((tenant) =>
        this.#adminTurn.run(actor, tenant, (current) =>
          this.#pending
            .byId(invitation)
            .andThen((row) =>
              row?.tenant.id === current.id ? this.#pending.remove(invitation) : okAsync(false),
            )
            .map(() => undefined),
        ),
      )
  }

  /**
   * What the link's `token` offers: the organisation's name and the role, and whether the viewer,
   * when signed in as `caller` (its email as the directory holds it), is the invited account. A
   * token that reads as nothing is refused `link-invalid`, one past its week `link-expired`.
   */
  read(input: {
    token: string
    caller?: { email: string } | undefined
  }): ResultAsync<InvitationOnLink, OrganisationError> {
    const { token, caller } = input

    return this.#pending.read(token).andThen((read) => {
      switch (read.kind) {
        case 'invitation':
          return okAsync<InvitationOnLink, OrganisationError>({
            organisation: { name: read.invitation.tenant.name },
            role: read.invitation.role,
            forYou: caller?.email.toLowerCase() === read.invitation.email,
          })
        case 'expired':
          return errAsync<InvitationOnLink, OrganisationError>(refused('link-expired'))
        case 'invalid':
          return errAsync<InvitationOnLink, OrganisationError>(refused('link-invalid'))
      }
    })
  }

  /**
   * The invitations of the account with `identity`'s email, newest first, to the organisations it
   * does not belong to; none for an account that is gone.
   */
  mine(input: { identity: IdentityId }): ResultAsync<readonly ReceivedInvitation[], DataError> {
    const { identity } = input

    return this.#lookup
      .emailOf(identity)
      .andThen((email) =>
        email === undefined ? okAsync([]) : this.#pending.forEmail(identity, email),
      )
  }

  /**
   * `identity` accepts the invitation `invitation` names, an id or a link's token
   * (`InvitationAnswers.accept`): it becomes a member with the role of the invitation and its
   * listeners hear it.
   */
  accept(input: {
    identity: IdentityId
    invitation: string
  }): ResultAsync<Membership, OrganisationError> {
    return this.#answers.accept(input)
  }

  /** `identity` declines the invitation `invitation` names (`InvitationAnswers.decline`). */
  decline(input: {
    identity: IdentityId
    invitation: string
  }): ResultAsync<void, OrganisationError> {
    return this.#answers.decline(input)
  }

  #view(invitation: PendingInvitation): InvitationView {
    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      link: this.#link(invitation.token),
    }
  }
}
