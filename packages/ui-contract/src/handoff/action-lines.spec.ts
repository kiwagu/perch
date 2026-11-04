import { describe, expect, it } from 'vitest'

import { actionLines } from './action-lines'

describe('actionLines', () => {
  it('says each parameter with its type, the result, the codes and the roles, descriptions aside', () => {
    expect(
      actionLines({
        description: 'Signs this device out.',
        params: { forgetUnsent: { type: 'boolean', description: 'Drop the unsent changes.' } },
        result: 'this device signs out',
        codes: ['failed', 'rate-limited'],
        roles: ['admin'],
      }),
    ).toEqual([
      'param forgetUnsent: boolean',
      'result: this device signs out',
      'code failed',
      'code rate-limited',
      'role admin',
    ])
  })
  it('says the mail with its recipient, its language and its link, and each notice by its name', () => {
    expect(
      actionLines({
        description: 'Sets a new password.',
        params: {},
        result: 'the password is the new one',
        codes: [],
        mail: {
          to: 'email',
          language: 'locale',
          link: { screen: 'user.verify-email', search: 'token' },
        },
        notices: [
          {
            name: 'password-changed',
            to: 'account',
            language: 'account',
            link: { screen: 'user.forgot-password' },
          },
          { name: 'email-changed', to: 'account', language: 'account' },
        ],
      }),
    ).toEqual([
      'result: the password is the new one',
      'mail to email language locale link user.verify-email?token',
      'notice password-changed to account language account link user.forgot-password',
      'notice email-changed to account language account',
    ])
  })
  it('has no line for an action one side lacks', () => {
    expect(actionLines(undefined)).toEqual([])
  })
})
