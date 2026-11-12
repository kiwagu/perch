import { describe, expect, it } from 'vitest'

import { activitySchema } from './activity.schema'

/** An activity of every field the schema accepts, each once. */
const SESSION = {
  id: 'session',
  title: 'The session of an account',
  description: 'From the sign-in page to the profile and back.',
  roles: ['guest', 'identity'],
  data: {
    account: { description: 'The account signed in.' },
    'profile.name': { description: 'Its name.', model: 'profile.name' },
  },
  initial: 'sign-in',
  meta: { guards: { noUnsentChanges: 'this device holds no changes it has not sent' } },
  states: {
    'sign-in': {
      description: 'The sign-in page.',
      meta: { screen: 'user.sign-in', address: { path: '/sign-in' } },
      on: { 'user.sign-in.submit-button': { target: 'profile', description: 'Signed in.' } },
    },
    profile: {
      meta: { screen: 'user.profile', address: { path: '/me' } },
      on: {
        'user.profile.sign-out-button': [{ target: 'signed-out', guard: 'noUnsentChanges' }],
      },
    },
    'signed-out': {
      type: 'final',
      meta: { screen: 'user.sign-in', address: { path: '/sign-in' } },
    },
  },
}

/** Whether the session with `change` applied to a copy of it parses. */
function changed(change: (activity: typeof SESSION) => void): boolean {
  const activity = structuredClone(SESSION)

  change(activity)

  return activitySchema.safeParse(activity).success
}

describe('activitySchema', () => {
  it('accepts an activity whose states are visits to screens', () => {
    expect(activitySchema.safeParse(SESSION).success).toBe(true)
  })
  it('accepts a state without transitions and an activity without data or guards', () => {
    expect(
      changed((activity) => {
        Reflect.deleteProperty(activity, 'data')
        Reflect.deleteProperty(activity, 'meta')
        Reflect.deleteProperty(activity.states.profile, 'on')
      }),
    ).toBe(true)
  })
  it('refuses a state named by a screen id, since XState reads a dot in a target as a path', () => {
    expect(
      changed((activity) => {
        Object.assign(activity.states, { 'user.profile': activity.states.profile })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states['sign-in'].on['user.sign-in.submit-button'], {
          target: 'user.profile',
        })
      }),
    ).toBe(false)
  })
  it('refuses a state that names no screen, or a screen outside the screen-name grammar', () => {
    expect(
      changed((activity) => {
        Object.assign(activity.states.profile, { meta: { address: { path: '/me' } } })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        activity.states.profile.meta.screen = 'User Profile'
      }),
    ).toBe(false)
  })
  it('refuses an address that is not a path, or one with more than a path', () => {
    expect(
      changed((activity) => {
        activity.states.profile.meta.address.path = 'me'
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states.profile.meta.address, { search: { tab: 'a' } })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states.profile.meta, { address: undefined })
      }),
    ).toBe(false)
  })
  it('refuses an invoke, an effect and entry or exit actions: the screens do the work', () => {
    expect(
      changed((activity) => {
        Object.assign(activity.states.profile, {
          invoke: { src: 'platform.sign-out', onDone: { target: 'signed-out' } },
        })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states['sign-in'].on['user.sign-in.submit-button'], {
          actions: [{ type: 'navigate', params: { to: '/me' } }],
        })
      }),
    ).toBe(false)
    for (const key of ['entry', 'exit']) {
      expect(
        changed((activity) => {
          Object.assign(activity.states.profile, {
            [key]: [{ type: 'show', params: { anchor: 'app-shell.notice-message', codes: ['x'] } }],
          })
        }),
      ).toBe(false)
    }
  })
  it('refuses a transition without a target, and an event that is no anchor', () => {
    expect(
      changed((activity) => {
        Object.assign(activity.states['sign-in'].on, { 'user.sign-in.submit-button': {} })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states['sign-in'].on, { SUBMIT: { target: 'profile' } })
      }),
    ).toBe(false)
  })
  it('refuses a data model that is not a field path, and an activity without roles', () => {
    expect(
      changed((activity) => {
        activity.data['profile.name'].model = 'profile'
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        activity.roles = []
      }),
    ).toBe(false)
  })
  it('takes a guard as a sentence only: a guard by failure code is for the onError of a flow', () => {
    expect(
      changed((activity) => {
        Object.assign(activity.meta.guards, { refused: { codes: ['email-not-verified'] } })
      }),
    ).toBe(false)
  })
  it('refuses what XState knows and the subset does not: a context, nested states', () => {
    expect(
      changed((activity) => {
        Object.assign(activity, { context: { name: null } })
      }),
    ).toBe(false)
    expect(
      changed((activity) => {
        Object.assign(activity.states.profile, { initial: 'a', states: { a: {} } })
      }),
    ).toBe(false)
  })
})
