import { describe, expect, it } from 'vitest'

import { parseYamlDocument } from '../../read-yaml-document'

import { screensOf, writtenBy } from './documents.fixture'
import { dropMailLinkSearch } from './mail-links'

const FILE = 'landing.yaml'

const PLATFORM = `# yaml-language-server: $schema=../schemas/platform.schema.json
version: 3
actions:
  invite:
    description: Sends the mail whose link opens the landing.
    mail:
      to: email
      link: { screen: sample.landing, search: token }
values:
  token:
    type: string
    minLength: 1
    maxLength: 4096
    description: The token the link of a mail carries.
    examples: [ token-0123456789abcdef ]
  loose: { type: string }
  free: { description: No type. }
  dated: { type: string, format: date-time }
`

const TOKEN = `        token:
          type: string
          minLength: 1
          maxLength: 4096
          description: The token the mail carries in its link.
          examples: [ "invite-0123456789abcdef" ]
`

const bindingWith = (properties: string, beside = ''): string =>
  `  - path: /landing
    roles: [ guest, identity ]
    history: push
    search:
      type: object
      properties:
${properties}${beside}      additionalProperties: false
`

const landingWith = (
  bindings: string,
): string => `# yaml-language-server: $schema=../../schemas/screen.schema.json
id: sample.landing
title: "Landing"
description: What the link of the mail opens, with a long plain scalar that runs far past the eighty columns the yaml package folds at
flag: null
bindings:
${bindings}entry: [ sample.landing.page ]
anchors:
  sample.landing.page:
    kind: page
`

const WITHOUT_SEARCH = `  - path: /landing
    roles: [ guest, identity ]
    history: push
`

/** Runs the part over the platform and one screen; what it names and the text of the screen it writes. */
function dropped(text: string, platform = PLATFORM): { manual: string[]; text: string } {
  const texts = { [FILE]: text }
  const screens = screensOf(texts)
  const manual = dropMailLinkSearch(parseYamlDocument(platform), screens)

  return { manual, text: writtenBy(texts, screens)[FILE] ?? '' }
}

describe('dropMailLinkSearch', () => {
  it('drops the parameter of the mail, and the search it leaves empty, whatever description and examples it wrote', () => {
    expect(dropped(landingWith(bindingWith(TOKEN)))).toEqual({
      manual: [],
      text: landingWith(WITHOUT_SEARCH),
    })
  })
  it('drops it from every route of the screen', () => {
    const two = `${bindingWith(TOKEN)}${bindingWith(TOKEN).replace('/landing', '/landing/$key')}`
    const expected = `${WITHOUT_SEARCH}${WITHOUT_SEARCH.replace('/landing', '/landing/$key')}`

    expect(dropped(landingWith(two))).toEqual({ manual: [], text: landingWith(expected) })
  })
  it('keeps the other parameters of the search, and the search with them', () => {
    const other = '        page: { type: integer, minimum: 1 }\n'

    expect(dropped(landingWith(bindingWith(`${other}${TOKEN}`)))).toEqual({
      manual: [],
      text: landingWith(bindingWith(other)),
    })
  })
  it('keeps a search that holds more than its properties, and its required list', () => {
    const required = bindingWith(TOKEN, '').replace(
      '      additionalProperties: false\n',
      '      required: [ token ]\n      additionalProperties: false\n',
    )
    const result = dropped(landingWith(required))

    expect(result.manual).toEqual([])
    expect(parseYamlDocument(result.text).toJS()).toMatchObject({
      bindings: [{ search: { properties: {}, required: ['token'], additionalProperties: false } }],
    })
  })
  it('keeps a parameter that holds something else than the platform value does, and names it', () => {
    const stricter = bindingWith(
      TOKEN.replace('minLength: 1', 'minLength: 8').replace('maxLength: 4096', 'maxLength: 64'),
    )

    expect(dropped(landingWith(stricter))).toEqual({
      manual: [
        'contract/domain/screens/landing.yaml: bindings[0].search.properties.token: it differs from the platform value "token" that the mail of invite derives it from, in minLength, maxLength: make them agree and drop it by hand',
      ],
      text: landingWith(stricter),
    })
  })
  it('leaves a screen no mail links to, and one that names no parameter', () => {
    const elsewhere = landingWith(bindingWith(TOKEN)).replace('sample.landing', 'sample.other')
    const bare = landingWith(WITHOUT_SEARCH)

    expect(dropped(elsewhere)).toEqual({ manual: [], text: elsewhere })
    expect(dropped(bare)).toEqual({ manual: [], text: bare })
  })
  it('names a mail whose parameter no platform value gives a route, and leaves its screen', () => {
    const text = landingWith(bindingWith(TOKEN))

    for (const name of ['missing', 'free', 'dated']) {
      const platform = PLATFORM.replace('search: token', `search: ${name}`)

      expect(dropped(text, platform)).toEqual({
        manual: [
          `contract/domain/platform.yaml: actions.invite.mail.link.search: "${name}" is no platform value a route can take (it needs a type and no format): fix it, and drop the property from the routes of sample.landing by hand`,
        ],
        text,
      })
    }
  })
  it('finds nothing to do in what it wrote', () => {
    const first = dropped(landingWith(bindingWith(TOKEN))).text

    expect(dropped(first)).toEqual({ manual: [], text: first })
  })
})
