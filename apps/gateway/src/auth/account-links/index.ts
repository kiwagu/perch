/**
 * The links of mails that act on an account: reset links, confirmations of a new email, deletions
 * of the account, and the tokens of verification links.
 */
export {
  AccountDeletions,
  type AccountDeletionsOptions,
  DELETION_LINK_LIFETIME_MS,
  type DeletionRead,
} from './account-deletions'
export type { ChangeClaims } from './change-token'
export type { DeletionClaims } from './deletion-token'
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
