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
        changes: [],
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
        changes: [],
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
  it('says the page sizes of an action that pages, and its default', () => {
    expect(
      actionLines({
        description: 'Reads the accounts.',
        params: {
          page: { type: 'number', description: 'The page.' },
          size: { type: 'number', description: 'The size.' },
        },
        paged: { sizes: [10, 25, 50], default: 25 },
        result: 'a page of accounts',
        codes: ['failed'],
        changes: [],
      }),
    ).toEqual([
      'param page: number',
      'param size: number',
      'result: a page of accounts',
      'code failed',
      'paged by 10, 25, 50, 25 by default',
    ])
  })
  it('says each read the action changes, and none where it changes none', () => {
    const invite = {
      description: 'Invites an email.',
      params: {},
      result: 'an invitation is pending',
      codes: [],
    }

    expect(
      actionLines({ ...invite, changes: ['organisations.invitations', 'accounts.read'] }),
    ).toEqual([
      'result: an invitation is pending',
      'changes organisations.invitations',
      'changes accounts.read',
    ])
    expect(actionLines({ ...invite, changes: [] })).toEqual(['result: an invitation is pending'])
  })
  it('says a parameter with the value it refers to, or its constraints, and whether it may be left out', () => {
    expect(
      actionLines({
        description: 'Signs this device in.',
        params: {
          email: { value: 'email', description: 'The email of the account.' },
          login: { value: 'email', maxLength: 100, description: 'A short email.' },
          name: { type: 'string', minLength: 1, maxLength: 80, description: 'A name.' },
          kind: { type: 'string', enum: ['a', 'b'], optional: true, description: 'A kind.' },
        },
        result: 'this device is signed in',
        codes: [],
        changes: [],
      }),
    ).toEqual([
      'param email: value email',
      'param login: value email, maxLength 100',
      'param name: string, minLength 1, maxLength 80',
      'param kind: string, enum ["a","b"], optional',
      'result: this device is signed in',
    ])
  })
  it('has no line for an action one side lacks', () => {
    expect(actionLines(undefined)).toEqual([])
  })
})

describe('actionLines of codes written as a map and a result written as a list', () => {
  it('gives each outcome line its result line, and each code its condition or its invariant', () => {
    expect(
      actionLines({
        description: 'Signs this device in.',
        params: {},
        result: ['the device is signed in', 'with the second factor on: asks for a code'],
        codes: {
          'invalid-credentials': 'the email or the password is wrong',
          'device-limit': { invariant: 'device-limit' },
        },
        changes: [],
      }),
    ).toEqual([
      'result: the device is signed in',
      'result: with the second factor on: asks for a code',
      'code invalid-credentials: the email or the password is wrong',
      'code device-limit: invariant device-limit',
    ])
  })
})
