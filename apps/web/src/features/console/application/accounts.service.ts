import type { ResultAsync } from 'neverthrow'

import { token } from '@workspace/di'
import type { IdentityId } from '@workspace/ids'

import type {
  AccountCard,
  AccountPage,
  AccountSearch,
  AccountsPort,
  ConsoleFailure,
  ListCode,
  ReadCode,
} from '../../../platform/accounts.port'

/**
 * The platform's accounts, for an operator, through the gateway's console routes: a page of
 * those a search finds, and one account's card. Each fails with a code of its action.
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
}

export const ACCOUNTS_SERVICE = token<AccountsService>('AccountsService')
