import { tokenLink } from '../../auth/account-mails'

/** The front's screen an invitation link opens: it shows the invitation the link's token names. */
export const INVITATION_PATH = '/invitation'

/** The link to the front's invitation screen carrying `token`, which a mail sends. */
export const invitationLink = (publicUrl: string, token: string): string =>
  tokenLink(publicUrl, INVITATION_PATH, token)
