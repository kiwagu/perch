import type { LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'
import type { RegionHub } from '@workspace/replica/server'

import type { InvitationMailer, PendingInvitations } from '../invitations'
import type { OrganisationLookup } from '../organisation-lookup'
import type { TenantDatabases } from '../tenant-databases'

import type { AdminTurn } from './admin-turn'
import type { OrganisationAdmission } from './admission'
import type { MembershipListeners } from './listeners'
import type { MembershipTurns } from './turns'

/** What the invitations of organisations are made of beyond the organisations themselves. */
export interface InvitationsOptions {
  /** The invitations the directory keeps. */
  readonly pending: PendingInvitations
  /** Starts the mail of an invitation. */
  readonly mailer: InvitationMailer
  /** The link to the front's invitation screen carrying `token`. */
  readonly link: (token: string) => string
}

/** What `OrganisationInvitations` is built from: the invitations, and the parts it shares with `Organisations`. */
export interface OrganisationInvitationsOptions extends InvitationsOptions {
  readonly lookup: OrganisationLookup
  readonly turns: MembershipTurns
  readonly adminTurn: AdminTurn
  readonly admission: OrganisationAdmission
  readonly listeners: MembershipListeners
}

export interface OrganisationsOptions {
  /** The directory database, opened as the gateway's namespace user. */
  readonly directory: LocalDb
  readonly databases: Pick<TenantDatabases, 'acquire' | 'evict'>
  /**
   * Takes the region of an organisation an identity was removed from from that identity's open
   * connections at once; resolves once none of them may name it any more.
   */
  readonly revoke: (identity: IdentityId, region: string) => Promise<void>
  /**
   * Judges the pushes of an identity's open connections into the region of an organisation by the
   * role it has there from now on, at once; resolves once every one of them does.
   */
  readonly rerole: (identity: IdentityId, region: string, role: TenantRole) => Promise<void>
  /** The region hub, which lets go of the region of an organisation a departure takes whole. */
  readonly hub: Pick<RegionHub, 'retire'>
  /** The invitations to organisations: their store, their mail and the link the mail carries. */
  readonly invitations: InvitationsOptions
}
