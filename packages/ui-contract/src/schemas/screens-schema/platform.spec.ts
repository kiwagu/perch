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

describe('platformSchema notices', () => {
  const sending = (notices: unknown) =>
    platformSchema.safeParse({ ...PLATFORM, actions: { send: { ...ACTION, notices } } }).success

  it('accepts notices to a parameter or the account, with a plain link or none', () => {
    expect(
      sending([
        { name: 'password-changed', to: 'account', language: 'account' },
        {
          name: 'email-changed',
          to: 'email',
          language: 'locale',
          link: { screen: 'user.reset-password' },
        },
      ]),
    ).toBe(true)
  })
  it('refuses a link with a search, a key of its own, a name out of kebab-case or no notice', () => {
    for (const notices of [
      [
        {
          name: 'password-changed',
          to: 'account',
          language: 'account',
          link: { screen: 'user.reset-password', search: 'token' },
        },
      ],
      [{ name: 'password-changed', to: 'account', language: 'account', subject: 'x' }],
      [{ name: 'passwordChanged', to: 'account', language: 'account' }],
      [{ to: 'account', language: 'account' }],
      [],
    ]) {
      expect(sending(notices), JSON.stringify(notices)).toBe(false)
    }
  })
})

describe('platformSchema composites', () => {
  const composites = (value: unknown) =>
    platformSchema.safeParse({ ...PLATFORM, composites: value }).success

  it('accepts a composite with its list, its item state and its items', () => {
    expect(
      composites({
        'password-rules': {
          description: 'The rules a new password keeps.',
          list: 'password-rule-list',
          itemState: 'met',
          items: { length: '10 to 35 characters.', digit: 'At least one digit.' },
        },
      }),
    ).toBe(true)
  })
  it('refuses a list that is not a list, an item out of kebab-case, a key of its own, no items', () => {
    const base = {
      description: 'The rules.',
      list: 'password-rule-list',
      itemState: 'met',
      items: { length: '10 to 35 characters.' },
    }

    for (const composite of [
      { ...base, list: 'password-rules' },
      { ...base, items: { Length: 'x' } },
      { ...base, items: {} },
      { ...base, kind: 'list' },
    ]) {
      expect(composites({ 'password-rules': composite }), JSON.stringify(composite)).toBe(false)
    }
  })
})

describe('platformSchema paged', () => {
  const paged = (value: unknown) =>
    platformSchema.safeParse({
      ...PLATFORM,
      actions: { 'accounts.list': { ...ACTION, paged: value } },
    }).success

  it('accepts the page sizes an action answers and its default', () => {
    expect(paged({ sizes: [10, 25, 50], default: 25 })).toBe(true)
    expect(paged({ sizes: [20], default: 20 })).toBe(true)
  })
  it('refuses no size, a size under 1 or not whole, no default, and a key of its own', () => {
    for (const value of [
      { sizes: [], default: 25 },
      { sizes: [0, 25], default: 25 },
      { sizes: [2.5], default: 2.5 },
      { sizes: [25] },
      { sizes: [25], default: 25, max: 50 },
      { size: 50 },
      true,
    ]) {
      expect(paged(value), JSON.stringify(value)).toBe(false)
    }
  })
})
