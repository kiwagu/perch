import { CONTRACT_ROLES, CONTRACT_ROUTES } from '@workspace/kernel'

import { defineModule } from '../../platform/module'

import { NotFoundContainer } from './presentation/pages/not-found/not-found.container'

/**
 * What an address no other route takes opens: it says no page is there and offers one way back.
 * Its route is the router's splat, which every other route outranks, for anyone. The router also
 * shows its page in the place of a page whose roles the device does not hold, at that page's
 * address.
 */
export const NotFoundModule = defineModule({
  id: 'not-found',
  declarations: { NotFoundPage: NotFoundContainer },
  routes: [
    {
      path: CONTRACT_ROUTES['not-found'],
      page: 'NotFoundPage',
      roles: [
        CONTRACT_ROLES.guest,
        CONTRACT_ROLES.identity,
        CONTRACT_ROLES.member,
        CONTRACT_ROLES.admin,
      ],
    },
  ],
})
