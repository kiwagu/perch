import type { TenantRole } from '@workspace/replica/protocol'

/** What sends the mail of an invitation: the organisations' service takes it, a fake stands in for it in specs. */
export interface InvitationMailer {
  /** Starts the invitation mail; never awaited, never fails the caller. */
  invite(input: {
    /** The address the invitation is for, as the invitation keeps it. */
    email: string
    /** The name of the organisation invited to. */
    organisation: string
    /** The role the account takes on accepting. */
    role: TenantRole
    /** The token of the invitation's link. */
    token: string
    /** The organisation's key: its default language speaks to an email no account has. */
    key: string
  }): void
}
