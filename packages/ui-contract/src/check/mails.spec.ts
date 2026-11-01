import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { sampleContract, screenIn } from './contract.fixture'
import { mailsProblems } from './mails'

const printed = (contract = sampleContract()): string[] =>
  mailsProblems(contract).map(formatProblem)

const AT = 'contract/domain/platform.yaml:1: actions["invite.send"].mail'

/** The sample contract with a platform action that sends `mail`. */
function sending(mail: unknown) {
  const contract = sampleContract()

  Object.assign(contract.screens.platform.actions, {
    'invite.send': {
      description: 'Sends an invitation.',
      params: {
        email: { type: 'string', description: 'The address.' },
        locale: { type: 'string', description: 'A language.' },
      },
      result: 'a mail is on its way',
      codes: ['failed'],
      mail,
    },
  })

  return contract
}

describe('mailsProblems', () => {
  it('finds nothing in a contract whose mails go to a parameter or the account and link to a route', () => {
    expect(printed()).toEqual([])
    expect(
      printed(
        sending({ to: 'email', language: 'locale', link: { screen: 'sample', search: 'tab' } }),
      ),
    ).toEqual([])
    expect(
      printed(
        sending({ to: 'account', language: 'account', link: { screen: 'sample', search: 'tab' } }),
      ),
    ).toEqual([])
  })
  it('wants the recipient and the language to be a parameter of the action or the account', () => {
    expect(
      printed(
        sending({ to: 'address', language: 'tongue', link: { screen: 'sample', search: 'tab' } }),
      ),
    ).toEqual([
      `${AT}.to: "address" is neither a parameter of "invite.send" nor account`,
      `${AT}.language: "tongue" is neither a parameter of "invite.send" nor account`,
    ])
  })
  it('refuses a parameter named account on an action that sends a mail: account is the account', () => {
    const contract = sending({
      to: 'account',
      language: 'account',
      link: { screen: 'sample', search: 'tab' },
    })

    Object.assign(contract.screens.platform.actions['invite.send']?.params ?? {}, {
      account: { type: 'string', description: 'An account.' },
    })

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: actions["invite.send"].params.account: "account" names the account in a mail or a notice, so an action that sends one gives no parameter that name',
    ])
  })
  it('refuses a parameter named account on an action that sends only notices, too', () => {
    const contract = sampleContract()

    Object.assign(contract.screens.platform.actions, {
      'password.change': {
        description: 'Changes the password.',
        params: { account: { type: 'string', description: 'An account.' } },
        result: 'the password is changed',
        codes: ['failed'],
        notices: [{ name: 'password-changed', to: 'account', language: 'account' }],
      },
    })

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: actions["password.change"].params.account: "account" names the account in a mail or a notice, so an action that sends one gives no parameter that name',
    ])
  })
  it('wants the link to open a screen with a route that declares the search parameter', () => {
    expect(
      printed(
        sending({ to: 'email', language: 'locale', link: { screen: 'gone', search: 'tab' } }),
      ),
    ).toEqual([`${AT}.link.screen: "gone" is no screen with a route`])
    expect(
      printed(
        sending({ to: 'email', language: 'locale', link: { screen: 'app-shell', search: 'tab' } }),
      ),
    ).toEqual([`${AT}.link.screen: "app-shell" is no screen with a route`])
    expect(
      printed(
        sending({ to: 'email', language: 'locale', link: { screen: 'sample', search: 'token' } }),
      ),
    ).toEqual([`${AT}.link.search: "token" is not a search parameter of every route of "sample"`])
  })
  it('wants the search parameter on every route of the screen, not on one of them', () => {
    const contract = sending({
      to: 'email',
      language: 'locale',
      link: { screen: 'sample', search: 'tab' },
    })

    screenIn(contract, 'sample').bindings.push({
      path: '/sample',
      roles: ['member'],
      history: 'push',
    })

    expect(printed(contract)).toEqual([
      `${AT}.link.search: "tab" is not a search parameter of every route of "sample"`,
    ])
  })
})
