import { forget, ROLE_CHANGED, ROLE_REFUSED } from './effects'
import { taken } from './events'

/**
 * The region of the screen's flow for the members' roles: one changes at a time, the one chosen
 * last. The row shows the role being set while the change runs (`changingRole`), the members are
 * read again once it is done, except after the account's own demotion (the list stops showing),
 * and a refusal clears the role being set so the row shows the one the member keeps.
 */
export const MEMBER_ROLES_REGION = {
  initial: 'idle',
  states: {
    idle: {
      on: {
        'organisation.members.role-select': { target: 'changing', actions: 'startChanging' },
      },
    },
    changing: {
      invoke: {
        src: 'platform.organisations.set-role',
        input: taken('organisation.members.role-select'),
        onDone: {
          target: 'idle',
          actions: [forget('members'), 'rereadAfterRole', 'settleRole', ROLE_CHANGED],
        },
        onError: { target: 'idle', actions: ['settleRole', ROLE_REFUSED] },
      },
    },
  },
} as const
