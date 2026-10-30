import { defineModule } from '../../platform/module'

import { NotFoundContainer } from './presentation/pages/not-found/not-found.container'

/**
 * What an address no other route takes opens: it says no page is there and offers one way back.
 * Its route is the router's splat, which every other route outranks.
 */
export const NotFoundModule = defineModule({
  id: 'not-found',
  declarations: { NotFoundPage: NotFoundContainer },
  routes: [{ path: '/$', page: 'NotFoundPage' }],
})
