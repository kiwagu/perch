/**
 * The links of mails that act on an account: reset links, confirmations of a new email, and the
 * tokens of verification links.
 */
export type { ChangeClaims } from './change-token'
export {
  type ChangeRead,
  CONFIRMATION_LINK_LIFETIME_MS,
  EmailChanges,
  type EmailChangesOptions,
} from './email-changes'
export { type ResetLink, ResetLinks } from './reset-links'
export {
  readVerificationToken,
  signVerificationToken,
  type VerificationClaims,
  verificationClaims,
  verificationKey,
} from './verification-token'
