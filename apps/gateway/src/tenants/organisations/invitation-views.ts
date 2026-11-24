import type { InvitationId } from '@workspace/ids'
import type { TenantRole } from '@workspace/replica/protocol'

/** An invitation as an admin of its organisation sees it: the email, the role and the link mailed. */
export interface InvitationView {
  readonly id: InvitationId
  readonly email: string
  readonly role: TenantRole
  readonly link: string
}

/** An invitation as the page its link opens shows it: no email, and whether it is for the viewer. */
export interface InvitationOnLink {
  readonly organisation: { readonly name: string }
  readonly role: TenantRole
  /** Whether the viewer is signed in with the invited email. */
  readonly forYou: boolean
}
