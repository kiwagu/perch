/**
 * The invitations an `Organisations` of a spec is built with: the real store over the directory,
 * a mailer that keeps what it was asked to mail instead of sending it, and the link a mail would
 * carry. A spec that invites reads what was mailed back from `mailed`, and moves the store's
 * clock to expire a link.
 */

import type { LocalDb } from '@workspace/data'
import type { IdentityId } from '@workspace/ids'
import type { Clock } from '@workspace/replica'
import type { Membership, TenantRole } from '@workspace/replica/protocol'
import { manualClock } from '@workspace/replica/testing'

import { type InvitationMailer, invitationLink, PendingInvitations } from '../invitations'
import type { Organisations } from '../organisations'

/** What the store of a spec signs its tokens with. */
const INVITATION_SECRET = 'invitation-spec-secret-0123456789-0123456789'

/** The address the front of a spec is served at. */
export const SPEC_PUBLIC_URL = 'https://app.example.test'

/** What a spec's mailer was asked to send, one entry per invitation. */
export type MailedInvitation = Parameters<InvitationMailer['invite']>[0]

/** The link to the invitation screen carrying `token`, as a spec's organisations make it. */
export const specLink = (token: string): string => invitationLink(SPEC_PUBLIC_URL, token)

/** The `invitations` option of `Organisations`, over `directory`, and the mails it was asked for. */
export function specInvitations(directory: LocalDb, clock: Clock = manualClock()) {
  const mailed: MailedInvitation[] = []

  return {
    pending: new PendingInvitations({
      directory,
      secret: INVITATION_SECRET,
      clock,
    }),
    mailer: {
      invite: (input: MailedInvitation): void => {
        mailed.push(input)
      },
    } satisfies InvitationMailer,
    link: specLink,
    mailed,
  }
}

/** What `admitted` is asked for: who invites, into which organisation, which account joins, as what. */
export interface Admission {
  readonly actor: IdentityId
  readonly key: string
  /** The account that joins: its identity and its email in the directory. */
  readonly invitee: { readonly id: IdentityId; readonly email: string }
  /** The role the invitation offers; `member` unless named. */
  readonly role?: TenantRole
}

/**
 * `invitee` becomes a member of the organisation the way an account does: `actor` invites its
 * email, and it accepts the invitation by the id the invite answered. For a spec that needs a
 * member to start from.
 */
export async function admitted(
  organisations: Organisations,
  { actor, key, invitee, role = 'member' }: Admission,
): Promise<Membership> {
  const invitation = (
    await organisations.invitations.invite({ actor, key, email: invitee.email, role })
  )._unsafeUnwrap()

  return (
    await organisations.invitations.accept({ identity: invitee.id, invitation: invitation.id })
  )._unsafeUnwrap()
}
