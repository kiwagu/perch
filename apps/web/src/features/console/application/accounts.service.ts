import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'

import type {
  AccountCard,
  AccountPage,
  AccountSearch,
  AccountsPort,
  Acted,
  BanCode,
  ChangeEmailCode,
  ConsoleFailure,
  ListCode,
  ReadCode,
  RemoveCode,
  RenameCode,
  ResendVerificationCode,
  RevokeSessionsCode,
  SendResetCode,
  UnbanCode,
} from '../../../platform/accounts.port'

/**
 * The platform's accounts, for an operator, through the gateway's console routes: a page of
 * those a search finds, one account's card, and the actions an operator takes on an account.
 * Each fails with a code of its action.
 */
export class AccountsService {
  constructor(private readonly accounts: AccountsPort) {}

  /** The page of accounts `search` names, newest first, and how many the search finds. */
  list(search: AccountSearch): ResultAsync<AccountPage, ConsoleFailure<ListCode>> {
    return this.accounts.list(search)
  }

  /** The account of `id`, with its organisations. */
  read(id: IdentityId): ResultAsync<AccountCard, ConsoleFailure<ReadCode>> {
    return this.accounts.read(id)
  }

  /** Sets the name of the account's profile. */
  rename(id: IdentityId, name: string): Acted<RenameCode> {
    return this.accounts.rename(id, name)
  }

  /** Mails the new email the link that changes it; the account keeps its email until then. */
  changeEmail(id: IdentityId, email: string): Acted<ChangeEmailCode> {
    return this.accounts.changeEmail(id, email)
  }

  /** Bans the account with `reason` (empty for none), signing its devices out. */
  ban(id: IdentityId, reason: string): Acted<BanCode> {
    return this.accounts.ban(id, reason)
  }

  /** Lifts the ban of the account. */
  unban(id: IdentityId): Acted<UnbanCode> {
    return this.accounts.unban(id)
  }

  /** Signs every device of the account out. */
  revokeSessions(id: IdentityId): Acted<RevokeSessionsCode> {
    return this.accounts.revokeSessions(id)
  }

  /** Mails the account the link that sets a new password. */
  sendReset(id: IdentityId): Acted<SendResetCode> {
    return this.accounts.sendReset(id)
  }

  /** Mails the account the link that verifies its email, again. */
  resendVerification(id: IdentityId): Acted<ResendVerificationCode> {
    return this.accounts.resendVerification(id)
  }

  /** Removes the account for good, as its own deletion would. */
  remove(id: IdentityId): Acted<RemoveCode> {
    return this.accounts.remove(id)
  }
}

export const ACCOUNTS_SERVICE = token<AccountsService>('AccountsService')
