import { okAsync, ResultAsync } from 'neverthrow'

import { type DataError, type LocalDb, recordId } from '@workspace/data'
import { type IdentityId, type InvitationId, idSchemas, invitationIdFactory } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import { type TenantRole, tenantRole } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { reading, type Tenant, writing } from '../organisation-rows'
import invitationByIdStatement from '../surql/invitation-by-id.surql'
import invitationRemoveStatement from '../surql/invitation-remove.surql'
import invitationReplaceStatement from '../surql/invitation-replace.surql'
import invitationsForEmailStatement from '../surql/invitations-for-email.surql'
import invitationsOfTenantStatement from '../surql/invitations-of-tenant.surql'

import { answered } from './answer'
import { invitationKey, readInvitationToken, signInvitationToken } from './token'

/** How long an invitation stays open after it was sent: seven days, on the gateway's clock. */
export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

/** An invitation as the directory holds it, with the organisation it is to. */
export interface PendingInvitation {
  readonly id: InvitationId
  readonly tenant: {
    readonly id: string
    readonly key: string
    readonly name: string
    /** Whether the organisation's database is set up: one still provisioning is nobody's yet. */
    readonly ready: boolean
  }
  /** The address invited, in lower case. */
  readonly email: string
  /** The role the invited account takes on accepting. */
  readonly role: TenantRole
  /** The token of the invitation's link, the very one the mail carried. */
  readonly token: string
  /** When the invitation expires, in ms since the epoch. */
  readonly expiresAt: number
}

/** An invitation as the invited account sees it: what it joins, and as what. */
export interface ReceivedInvitation {
  readonly id: InvitationId
  readonly organisation: { readonly name: string }
  readonly role: TenantRole
}

/**
 * What the token of an invitation link reads as: the invitation it opens, one past its week, or
 * nothing (a token the gateway did not sign, an invitation that was replaced, accepted, declined
 * or revoked, or one to an organisation that is not ready).
 */
export type InvitationRead =
  | { readonly kind: 'invitation'; readonly invitation: PendingInvitation }
  | { readonly kind: 'expired' }
  | { readonly kind: 'invalid' }

export interface PendingInvitationsOptions {
  /** The directory, where an invitation lives. */
  readonly directory: LocalDb
  /** Better Auth's secret, from which the key of the invitation tokens is derived. */
  readonly secret: string
  /** When an invitation is sent, and when it expires. */
  readonly clock: Clock
}

/** The directory's row of an invitation with its organisation, once its values are plain. */
const pendingRow = z
  .object({
    id: idSchemas.invitation.schema,
    tenant: z.string(),
    key: z.string(),
    name: z.string(),
    status: z.enum(['provisioning', 'ready']),
    email: z.string(),
    role: tenantRole,
    token: z.string(),
    expires_at: z.date(),
  })
  .transform(
    (row): PendingInvitation => ({
      id: row.id,
      tenant: { id: row.tenant, key: row.key, name: row.name, ready: row.status === 'ready' },
      email: row.email,
      role: row.role,
      token: row.token,
      expiresAt: row.expires_at.getTime(),
    }),
  )

/** The directory's row of an invitation as the invited account sees it. */
const receivedRow = z
  .object({ id: idSchemas.invitation.schema, name: z.string(), role: tenantRole })
  .transform(
    (row): ReceivedInvitation => ({
      id: row.id,
      organisation: { name: row.name },
      role: row.role,
    }),
  )

/**
 * What `invitation-remove.surql` answers: the rows it deleted, none when the invitation was not
 * there. A row needs to be a row, nothing more: its values are not read.
 */
const deletedRows = z.array(z.object({}))

/**
 * The invitations to organisations that an email has not yet answered. An invitation is a row of
 * the directory, one per organisation and email, so a newer invitation of the email replaces the
 * older in one transaction and the older link then names a row that is gone. Its link carries a
 * token signed with a key derived from the auth secret, naming the row; the token is kept on the
 * row, so the list of an organisation's invitations answers the very link the mail carried. A
 * link's week is judged on the gateway's clock from the moment it was sent, so an expired link
 * whose row was swept still reads as one that expired. The rows of expired invitations are swept
 * by the next invitation of the same organisation and go with their organisation. Nothing here
 * logs, and no error names a token or an address.
 */
export class PendingInvitations {
  readonly #directory: LocalDb
  readonly #key: string
  readonly #clock: Clock

  constructor(options: PendingInvitationsOptions) {
    this.#directory = options.directory
    this.#key = invitationKey(options.secret)
    this.#clock = options.clock
  }

  /**
   * Mints the invitation's id, signs its token, keeps the row (replacing the email's pending
   * invitation to the organisation, and sweeping the organisation's expired ones) and answers it.
   * `tenant` is a ready organisation, as `OrganisationLookup.tenantOf` answers, so the answer
   * says it is ready.
   */
  replace(input: {
    readonly tenant: Tenant
    readonly email: string
    readonly role: TenantRole
    readonly inviter: IdentityId
  }): ResultAsync<PendingInvitation, DataError> {
    const at = this.#clock.now()
    const id = invitationIdFactory.create()
    const email = input.email.toLowerCase()
    const expiresAt = at + INVITATION_LIFETIME_MS

    return ResultAsync.fromSafePromise(
      signInvitationToken({ purpose: 'invitation', invitation: id, at }, this.#key),
    ).andThen((token) =>
      writing(
        this.#directory.db
          .query(invitationReplaceStatement, {
            id,
            tenant: recordId('tenant', input.tenant.id),
            email,
            role: input.role,
            inviter: recordId('identity', input.inviter),
            link_token: token,
            expires_at: new Date(expiresAt),
            now: new Date(at),
          })
          .retry(),
        `the invitation to ${input.tenant.key} could not be kept`,
      ).map(
        (): PendingInvitation => ({
          id,
          tenant: {
            id: input.tenant.id,
            key: input.tenant.key,
            name: input.tenant.name,
            ready: true,
          },
          email,
          role: input.role,
          token,
          expiresAt,
        }),
      ),
    )
  }

  /** The organisation's invitations not expired, newest first, whatever account has the email now. */
  ofTenant(tenant: Tenant): ResultAsync<readonly PendingInvitation[], DataError> {
    return reading(
      this.#directory.db.query(invitationsOfTenantStatement, {
        tenant: recordId('tenant', tenant.id),
        now: new Date(this.#clock.now()),
      }),
      `the invitations to ${tenant.key} could not be read`,
    ).andThen((answer) =>
      answered(z.array(pendingRow), answer, 'the answer to the invitations to an organisation'),
    )
  }

  /**
   * The invitations of `email` not expired, to the ready organisations `identity` does not belong
   * to, newest first.
   */
  forEmail(
    identity: IdentityId,
    email: string,
  ): ResultAsync<readonly ReceivedInvitation[], DataError> {
    return reading(
      this.#directory.db.query(invitationsForEmailStatement, {
        identity: recordId('identity', identity),
        email: email.toLowerCase(),
        now: new Date(this.#clock.now()),
      }),
      `the invitations of ${identity} could not be read`,
    ).andThen((answer) =>
      answered(z.array(receivedRow), answer, 'the answer to the invitations of an email'),
    )
  }

  /** The invitation `id`; none when it is gone or expired. */
  byId(id: InvitationId): ResultAsync<PendingInvitation | undefined, DataError> {
    return reading(
      this.#directory.db.query(invitationByIdStatement, {
        id,
        now: new Date(this.#clock.now()),
      }),
      `the invitation ${id} could not be read`,
    ).andThen((answer) =>
      answered(pendingRow.nullish(), answer, 'the answer to an invitation').map(
        (row) => row ?? undefined,
      ),
    )
  }

  /**
   * What `token` reads as: `invalid` for a token the gateway did not sign as an invitation token,
   * `expired` once a week has passed since it was sent, `invalid` again when its row is gone or
   * its organisation is not ready, the invitation otherwise.
   */
  read(token: string): ResultAsync<InvitationRead, DataError> {
    return ResultAsync.fromSafePromise(readInvitationToken(token, this.#key)).andThen(
      (claims): ResultAsync<InvitationRead, DataError> => {
        if (claims === undefined) {
          return okAsync({ kind: 'invalid' })
        }

        if (claims.at + INVITATION_LIFETIME_MS <= this.#clock.now()) {
          return okAsync({ kind: 'expired' })
        }

        return this.byId(claims.invitation).map(
          (invitation): InvitationRead =>
            invitation?.tenant.ready ? { kind: 'invitation', invitation } : { kind: 'invalid' },
        )
      },
    )
  }

  /** Deletes the invitation `id`: true when it was there, false when it was not. */
  remove(id: InvitationId): ResultAsync<boolean, DataError> {
    return writing(
      this.#directory.db.query(invitationRemoveStatement, { id }).retry(),
      `the invitation ${id} could not be removed`,
    ).andThen((answer) =>
      answered(deletedRows, answer, 'the answer to the removal of an invitation').map(
        (rows) => rows.length > 0,
      ),
    )
  }
}
