/**
 * The invitations an `Organisations` of a spec is built with: the real store over the directory,
 * a mailer that keeps what it was asked to mail instead of sending it, and the link a mail would
 * carry. A spec that invites reads what was mailed back from `mailed`, and moves the store's
 * clock to expire a link.
 */

import type { LocalDb } from '@workspace/data'
import type { Clock } from '@workspace/replica'
import { manualClock } from '@workspace/replica/testing'

import { type InvitationMailer, invitationLink, PendingInvitations } from '../invitations'

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
