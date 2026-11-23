import { describe, expect, it } from 'vitest'

import { invariantActions } from './invariants'
import type { Platform } from './screens'

const action = (codes: Platform['actions'][string]['codes']): Platform['actions'][string] => ({
  description: 'Does a thing.',
  params: {},
  result: 'the thing is done',
  codes,
  changes: [],
})

const PLATFORM: Platform = {
  actions: {
    'sign-in': action({
      'device-limit': { invariant: 'device-limit' },
      'rate-limited': { invariant: 'failed-sign-ins' },
      failed: 'anything else fails',
    }),
    'sign-out': action(['failed']),
    'confirm-sign-in': action({
      'rate-limited': { invariant: 'failed-sign-ins' },
      'device-limit': { invariant: 'device-limit' },
    }),
  },
  invariants: {
    'failed-sign-ins': { rule: 'Ten wrong passwords lock the email out.', refuses: 'rate-limited' },
    'device-limit': { rule: 'Ten devices at most.', refuses: 'device-limit' },
    unused: { rule: 'Nobody names it.', refuses: 'failed' },
  },
  reserved: [],
  status: { anchor: 'app-shell.status', states: ['ready'] },
}

describe('invariantActions', () => {
  it('gives each invariant the actions that name it, in the order the platform writes them', () => {
    expect(invariantActions(PLATFORM)).toEqual({
      'failed-sign-ins': ['sign-in', 'confirm-sign-in'],
      'device-limit': ['sign-in', 'confirm-sign-in'],
      unused: [],
    })
  })
  it('gives nothing to a platform with no invariants', () => {
    const { invariants: _invariants, ...without } = PLATFORM

    expect(invariantActions(without)).toEqual({})
  })
  it('lists an action once however many of its codes name the invariant', () => {
    const platform: Platform = {
      ...PLATFORM,
      actions: {
        twice: action({
          'device-limit': { invariant: 'device-limit' },
          'rate-limited': { invariant: 'device-limit' },
        }),
      },
    }

    expect(invariantActions(platform)['device-limit']).toEqual(['twice'])
  })
  it('lists an action under each invariant one code names together', () => {
    const platform: Platform = {
      ...PLATFORM,
      actions: {
        'change-email': action({
          'rate-limited': {
            invariant: ['failed-sign-ins', 'unused'],
            condition: 'a fourth change within a quarter of an hour',
          },
        }),
      },
    }

    expect(invariantActions(platform)).toEqual({
      'failed-sign-ins': ['change-email'],
      'device-limit': [],
      unused: ['change-email'],
    })
  })
})
