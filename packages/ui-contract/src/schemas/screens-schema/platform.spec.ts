import { describe, expect, it } from 'vitest'

import { platformSchema } from './platform'

const PLATFORM = {
  actions: {},
  reserved: ['app-shell.status'],
  status: { anchor: 'app-shell.status', states: ['opening', 'ready'] },
}

describe('platformSchema events', () => {
  it('accepts no events, and events by name with their meaning', () => {
    expect(platformSchema.safeParse(PLATFORM).success).toBe(true)
    expect(
      platformSchema.safeParse({ ...PLATFORM, events: { opened: 'the local data is open' } })
        .success,
    ).toBe(true)
  })
  it('refuses an event whose name is not one kebab-case word group', () => {
    for (const name of ['Opened', 'data.opened', 'platform.opened']) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, events: { [name]: 'the local data is open' } })
          .success,
        name,
      ).toBe(false)
    }
  })
})

const ACTION = {
  description: 'Sends a link.',
  params: { email: { type: 'string', description: 'The address.' } },
  result: 'a mail is on its way',
  codes: ['failed'],
}

describe('platformSchema mail', () => {
  it('accepts a mail to a parameter or the account, in a parameter or the account, linking to a screen', () => {
    for (const mail of [
      { to: 'email', language: 'locale', link: { screen: 'user.verify-email', search: 'token' } },
      {
        to: 'account',
        language: 'account',
        link: { screen: 'user.reset-password', search: 'token' },
      },
    ]) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, actions: { send: { ...ACTION, mail } } }).success,
      ).toBe(true)
    }
  })
  it('refuses a mail without a link, or with a key of its own', () => {
    for (const mail of [
      { to: 'email', language: 'account' },
      { to: 'email', language: 'account', link: { screen: 'user.verify-email' } },
      {
        to: 'email',
        language: 'account',
        link: { screen: 'user.verify-email', search: 'token' },
        subject: 'x',
      },
    ]) {
      expect(
        platformSchema.safeParse({ ...PLATFORM, actions: { send: { ...ACTION, mail } } }).success,
      ).toBe(false)
    }
  })
})
