import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { sampleContract, screenIn } from './contract.fixture'
import { noticesProblems } from './notices'

const printed = (contract = sampleContract()): string[] =>
  noticesProblems(contract).map(formatProblem)

const AT = 'contract/domain/platform.yaml:1: actions["password.change"].notices'

/**
 * The sample contract with a screen whose one route needs no parameter, `/sample-help`, and a
 * platform action that sends `notices`.
 */
function sending(notices: unknown) {
  const contract = sampleContract()

  contract.screens.screens.push({
    id: 'sample.help',
    title: 'Help',
    description: 'Where a notice leads.',
    bindings: [{ path: '/sample-help', roles: ['member'], history: 'push' }],
    flag: null,
    entry: ['sample.help.page'],
    anchors: { 'sample.help.page': { kind: 'page' } },
  })
  contract.screens.files = [...contract.screens.files, 'contract/domain/screens/sample-help.yaml']
  Object.assign(contract.screens.platform.actions, {
    'password.change': {
      description: 'Changes the password.',
      params: {
        email: { type: 'string', description: 'The address.' },
        locale: { type: 'string', description: 'A language.' },
      },
      result: 'the password is changed',
      codes: ['failed'],
      notices,
    },
  })

  return contract
}

describe('noticesProblems', () => {
  it('finds nothing in notices to a parameter or the account, with a plain link or none', () => {
    expect(printed()).toEqual([])
    expect(
      printed(
        sending([
          { name: 'password-changed', to: 'account', language: 'account' },
          {
            name: 'email-changed',
            to: 'email',
            language: 'locale',
            link: { screen: 'sample.help' },
          },
        ]),
      ),
    ).toEqual([])
  })
  it('wants the recipient and the language to be a parameter of the action or the account', () => {
    expect(
      printed(sending([{ name: 'password-changed', to: 'address', language: 'tongue' }])),
    ).toEqual([
      `${AT}[0].to: "address" is neither a parameter of "password.change" nor account`,
      `${AT}[0].language: "tongue" is neither a parameter of "password.change" nor account`,
    ])
  })
  it('takes a parameter named recipient as the language of a notice: there it is no keyword', () => {
    const contract = sending([{ name: 'password-changed', to: 'account', language: 'recipient' }])

    Object.assign(contract.screens.platform.actions['password.change']?.params ?? {}, {
      recipient: { type: 'string', description: 'A language.' },
    })

    expect(printed(contract)).toEqual([])
  })
  it('refuses the recipient as the language of a notice: only a mail speaks it', () => {
    expect(
      printed(sending([{ name: 'password-changed', to: 'account', language: 'recipient' }])),
    ).toEqual([
      `${AT}[0].language: "recipient" is the language of a mail alone; a notice speaks a parameter's or the account's`,
    ])
  })
  it('wants the names unique within the action', () => {
    expect(
      printed(
        sending([
          { name: 'password-changed', to: 'account', language: 'account' },
          { name: 'password-changed', to: 'email', language: 'account' },
        ]),
      ),
    ).toEqual([
      `${AT}[1].name: "password-changed" is the name of another notice of "password.change"`,
    ])
  })
  it('wants the link to open a screen with a route', () => {
    expect(
      printed(
        sending([
          { name: 'gone', to: 'account', language: 'account', link: { screen: 'gone' } },
          { name: 'frame', to: 'account', language: 'account', link: { screen: 'app-shell' } },
        ]),
      ),
    ).toEqual([
      `${AT}[0].link.screen: "gone" is no screen with a route`,
      `${AT}[1].link.screen: "app-shell" is no screen with a route`,
    ])
  })
  it('wants every route of the linked screen to need no parameter: the link carries none', () => {
    expect(
      printed(
        sending([
          { name: 'sample', to: 'account', language: 'account', link: { screen: 'sample' } },
        ]),
      ),
    ).toEqual([
      `${AT}[0].link.screen: the route "/sample/$key" of "sample" needs a parameter, and a notice's link carries none`,
    ])

    const contract = sending([
      { name: 'help', to: 'account', language: 'account', link: { screen: 'sample.help' } },
    ])
    const [help] = screenIn(contract, 'sample.help').bindings

    if (help !== undefined) {
      help.search = {
        type: 'object',
        properties: { topic: { type: 'string' } },
        required: ['topic'],
        additionalProperties: false,
      }
    }

    expect(printed(contract)).toEqual([
      `${AT}[0].link.screen: the route "/sample-help" of "sample.help" needs a parameter, and a notice's link carries none`,
    ])
  })
  it('lets the link open a route whose parameters are optional or have their defaults', () => {
    const contract = sending([
      { name: 'help', to: 'account', language: 'account', link: { screen: 'sample.help' } },
    ])

    screenIn(contract, 'sample.help').bindings = [
      {
        path: '/sample-help/{-$topic}',
        roles: ['member'],
        history: 'push',
        params: {
          type: 'object',
          properties: { topic: { type: 'string' } },
          additionalProperties: false,
        },
        search: {
          type: 'object',
          properties: { page: { type: 'integer', default: 1 } },
          additionalProperties: false,
        },
      },
    ]

    expect(printed(contract)).toEqual([])
  })
})
