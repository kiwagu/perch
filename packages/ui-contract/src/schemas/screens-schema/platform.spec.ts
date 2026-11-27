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
  changes: [],
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
  it('takes a list of two sources or more for the language, each named once', () => {
    const link = { screen: 'organisation.invitation', search: 'token' }
    const parses = (language: unknown): boolean =>
      platformSchema.safeParse({
        ...PLATFORM,
        actions: { send: { ...ACTION, mail: { to: 'email', language, link } } },
      }).success

    expect(parses(['recipient', 'organisation'])).toBe(true)
    expect(parses(['recipient', 'locale'])).toBe(true)
    for (const language of [[], ['recipient'], ['recipient', 'recipient'], ['Recipient', 'x']]) {
      expect(parses(language), JSON.stringify(language)).toBe(false)
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

describe('platformSchema changes', () => {
  const changing = (value: unknown) =>
    platformSchema.safeParse({
      ...PLATFORM,
      actions: { 'organisations.invite': { ...ACTION, changes: value } },
    }).success

  it('accepts the platform actions an action changes the answer of, and none', () => {
    expect(changing(['organisations.invitations'])).toBe(true)
    expect(changing(['devices.list', 'accounts.read'])).toBe(true)
    expect(changing([])).toBe(true)
  })
  it('refuses a name no platform action could have, and anything but a list', () => {
    for (const value of [['Devices.list'], ['devices list'], ['devices.'], 'devices.list', true]) {
      expect(changing(value), JSON.stringify(value)).toBe(false)
    }
  })
  it('refuses an action that does not say what it changes, at its changes', () => {
    const { changes: _changes, ...unsaid } = ACTION
    const parsed = platformSchema.safeParse({ ...PLATFORM, actions: { send: unsaid } })

    expect(parsed.error?.issues.map(({ path }) => path)).toEqual([['actions', 'send', 'changes']])
  })
})

describe('platformSchema codes, result and invariants', () => {
  const parses = (action: Readonly<Record<string, unknown>>, platform = {}) =>
    platformSchema.safeParse({
      ...PLATFORM,
      ...platform,
      actions: { 'sign-in': { ...ACTION, ...action } },
    }).success
  const INVARIANTS = {
    invariants: {
      'device-limit': {
        rule: 'An account is signed in on ten devices at most at once.',
        refuses: 'device-limit',
      },
    },
  }

  it('accepts the codes as a map, each with its condition or the invariant it refuses for', () => {
    expect(
      parses(
        {
          codes: {
            'invalid-credentials': 'the email or the password is wrong',
            'device-limit': { invariant: 'device-limit' },
            failed: 'anything else fails',
          },
        },
        INVARIANTS,
      ),
    ).toBe(true)
    expect(parses({ codes: {} })).toBe(true)
  })
  it('still accepts the codes as a list of names', () => {
    expect(parses({ codes: ['failed'] })).toBe(true)
  })
  it('refuses an empty condition, a key beside the invariant, or a code no code could be', () => {
    for (const codes of [
      { failed: '' },
      { 'device-limit': { invariant: 'device-limit', also: 'x' } },
      { 'device-limit': { invariant: 'Device limit' } },
      { Failed: 'anything else fails' },
      { failed: 3 },
    ]) {
      expect(parses({ codes }, INVARIANTS), JSON.stringify(codes)).toBe(false)
    }
  })
  it('accepts the result as one outcome or a list of outcome lines', () => {
    expect(parses({ result: 'the device is signed in' })).toBe(true)
    expect(
      parses({ result: ['the device is signed in', 'with the second factor on: asks for a code'] }),
    ).toBe(true)
  })
  it('refuses an empty list of outcomes and an empty outcome line', () => {
    for (const result of [[], [''], ['the device is signed in', '']]) {
      expect(parses({ result }), JSON.stringify(result)).toBe(false)
    }
  })
  it('accepts invariants by name, each with its rule and the code it refuses with', () => {
    expect(parses({}, INVARIANTS)).toBe(true)
  })
  it('accepts the values an invariant states: a count, a duration in one unit', () => {
    const stating = (values: unknown) => ({
      invariants: { 'device-limit': { rule: '{limit} at most.', refuses: 'device-limit', values } },
    })

    for (const values of [
      { limit: 10 },
      { limit: 10, window: { minutes: 15 } },
      { accountLimit: 30, window: { seconds: 10 } },
      { window: { hours: 1 } },
    ]) {
      expect(parses({}, stating(values)), JSON.stringify(values)).toBe(true)
    }
    for (const values of [
      {},
      { limit: 0 },
      { limit: -1 },
      { limit: 1.5 },
      { limit: '10' },
      { window: { minutes: 15, seconds: 1 } },
      { window: { days: 1 } },
      { window: { minutes: 0 } },
      { Limit: 10 },
      { 'account-limit': 30 },
    ]) {
      expect(parses({}, stating(values)), JSON.stringify(values)).toBe(false)
    }
  })
  it('refuses an invariant without its rule or its code, with a key of its own, or misnamed', () => {
    for (const invariants of [
      { 'device-limit': { rule: 'Ten devices at most.' } },
      { 'device-limit': { refuses: 'device-limit' } },
      { 'device-limit': { rule: '', refuses: 'device-limit' } },
      { 'device-limit': { rule: 'Ten devices at most.', refuses: 'device-limit', actions: [] } },
      { 'Device limit': { rule: 'Ten devices at most.', refuses: 'device-limit' } },
    ]) {
      expect(parses({}, { invariants }), JSON.stringify(invariants)).toBe(false)
    }
  })
  it('accepts a code naming several invariants, or invariants with a condition of its own beside them', () => {
    const SEVERAL = {
      invariants: {
        'failed-sign-ins': { rule: 'Ten wrong passwords keep it out.', refuses: 'rate-limited' },
        'address-mails': {
          rule: 'Two hundred mails a quarter of an hour.',
          refuses: 'rate-limited',
        },
      },
    }

    for (const codes of [
      { 'rate-limited': { invariant: ['failed-sign-ins', 'address-mails'] } },
      {
        'rate-limited': {
          invariant: 'address-mails',
          condition: 'a fourth request within a quarter of an hour',
        },
      },
      {
        'rate-limited': {
          invariant: ['failed-sign-ins', 'address-mails'],
          condition: 'a fourth change by the account within a quarter of an hour',
        },
      },
    ]) {
      expect(parses({ codes }, SEVERAL), JSON.stringify(codes)).toBe(true)
    }
  })
  it('refuses a list of one invariant, a name twice, an empty list, an empty condition, and a condition with no invariant', () => {
    for (const codes of [
      { 'rate-limited': { invariant: ['failed-sign-ins'] } },
      { 'rate-limited': { invariant: ['failed-sign-ins', 'failed-sign-ins'] } },
      { 'rate-limited': { invariant: [] } },
      { 'rate-limited': { invariant: 'failed-sign-ins', condition: '' } },
      { 'rate-limited': { condition: 'a fourth request' } },
    ]) {
      expect(parses({ codes }), JSON.stringify(codes)).toBe(false)
    }
  })
})
