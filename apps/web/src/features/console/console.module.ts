import { ACCOUNTS } from '../../platform/accounts.port'
import { defineModule } from '../../platform/module'

import { ACCOUNTS_SERVICE, AccountsService } from './application/accounts.service'
import { AccountSearchSchema } from './domain/account-search.entity'
import { UsersContainer } from './presentation/pages/users/users.container'

/**
 * The platform operator's console: the platform's accounts, a page at a time, found by a part of
 * their email or name. Its pages open for an operator alone; any other device gets the not-found
 * page at the same address.
 */
export const ConsoleModule = defineModule({
  id: 'console',
  providers: [
    {
      provide: ACCOUNTS_SERVICE,
      useFactory: (container) => new AccountsService(container.get(ACCOUNTS)),
    },
  ],
  declarations: { UsersPage: UsersContainer },
  routes: [
    {
      path: '/console/users',
      page: 'UsersPage',
      roles: ['operator'],
      history: 'push',
      retain: ['size'],
      search: AccountSearchSchema,
    },
  ],
})
