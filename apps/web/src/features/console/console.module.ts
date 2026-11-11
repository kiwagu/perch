import { ACCOUNTS } from '../../platform/accounts.port'
import { defineModule } from '../../platform/module'

import { ACCOUNTS_SERVICE, AccountsService } from './application/accounts.service'
import { AccountCardSearchSchema } from './domain/account-card.entity'
import { AccountSearchSchema } from './domain/account-search.entity'

/**
 * The platform operator's console: the platform's accounts, a page at a time, found by a part of
 * their email or name, and the card of one account with the actions an operator takes on it.
 * Its pages open for an operator alone; any other device gets the not-found page at the same
 * address, and never loads their code.
 */
export const ConsoleModule = defineModule({
  id: 'console',
  providers: [
    {
      provide: ACCOUNTS_SERVICE,
      useFactory: (container) => new AccountsService(container.get(ACCOUNTS)),
    },
  ],
  // Dynamic imports: screens open only to a platform role load when such a route first opens, so
  // no other user's first frame carries them.
  declarations: {
    UsersPage: {
      load: () =>
        import('./presentation/pages/users/users.container').then(
          ({ UsersContainer }) => UsersContainer,
        ),
    },
    AccountPage: {
      load: () =>
        import('./presentation/pages/account/account.container').then(
          ({ AccountContainer }) => AccountContainer,
        ),
    },
  },
  routes: [
    {
      path: '/console/users',
      page: 'UsersPage',
      roles: ['operator'],
      history: 'push',
      retain: ['size'],
      search: AccountSearchSchema,
    },
    {
      path: '/console/account',
      page: 'AccountPage',
      roles: ['operator'],
      history: 'push',
      search: AccountCardSearchSchema,
    },
  ],
})
