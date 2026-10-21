import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { sampleContract, screenIn } from './contract.fixture'
import { searchProblems } from './search'

const printed = (contract = sampleContract()): string[] =>
  searchProblems(contract).map(formatProblem)

const AT = 'contract/screens.json:1: screens[1].bindings[0]'

/** The first binding of the sample screen, for a spec to change. */
function sampleBinding(contract: ReturnType<typeof sampleContract>) {
  const binding = screenIn(contract, 'sample').bindings[0]

  if (binding === undefined) {
    throw new Error('no binding')
  }

  return binding
}

describe('searchProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('wants a control for every enum value, and no control for another value', () => {
    const contract = sampleContract()

    sampleBinding(contract).search = {
      type: 'object',
      properties: {
        tab: {
          type: 'string',
          enum: ['a', 'b', 'c'],
          'x-perch': {
            values: { a: { control: 'sample.a-button' }, z: { control: 'sample.b-button' } },
          },
        },
        page: { type: 'integer', enum: [1, 2] },
      },
      additionalProperties: false,
    }

    expect(printed(contract)).toEqual([
      `${AT}.search.properties.tab: the enum value "b" has no control under x-perch.values`,
      `${AT}.search.properties.tab: the enum value "c" has no control under x-perch.values`,
      `${AT}.search.properties.tab["x-perch"].values.z: "z" is not an enum value`,
      `${AT}.search.properties.page: the enum value "1" has no control under x-perch.values`,
      `${AT}.search.properties.page: the enum value "2" has no control under x-perch.values`,
    ])
  })
  it('wants every control to be a declared anchor, in params too', () => {
    const contract = sampleContract()
    const binding = sampleBinding(contract)

    binding.params = {
      type: 'object',
      properties: { key: { type: 'string', 'x-perch': { control: 'sample.key-select.option' } } },
      additionalProperties: false,
    }
    Object.assign(binding.search?.properties['tab'] ?? {}, {
      'x-perch': {
        control: 'sample.tab-select',
        values: { a: { control: 'sample.a-button' }, b: { control: 'sample.gone-button' } },
      },
    })

    expect(printed(contract)).toEqual([
      `${AT}.search.properties.tab["x-perch"].control: "sample.tab-select" is not a declared anchor`,
      `${AT}.search.properties.tab["x-perch"].values.b.control: "sample.gone-button" is not a declared anchor`,
    ])
  })
  it('wants retain to name search parameters', () => {
    const contract = sampleContract()
    const binding = sampleBinding(contract)

    binding.retain = ['tab', 'sort']

    expect(printed(contract)).toEqual([`${AT}.retain[1]: "sort" is not a search parameter`])

    delete binding.search

    expect(printed(contract)).toEqual([
      `${AT}.retain[0]: "tab" is not a search parameter`,
      `${AT}.retain[1]: "sort" is not a search parameter`,
    ])
  })
  it('takes a derived control only through a suffix its base lists in derived', () => {
    const contract = sampleContract()

    Object.assign(sampleBinding(contract).search?.properties['tab'] ?? {}, {
      'x-perch': {
        control: 'sample.mode-select.option',
        values: { a: { control: 'sample.a-button.option' }, b: { control: 'sample.b-button' } },
      },
    })

    expect(printed(contract)).toEqual([
      `${AT}.search.properties.tab["x-perch"].values.a.control: "sample.a-button.option" is not a declared anchor`,
    ])
  })
  it('wants a controlValue to be a choice value of its control, pattern rows included', () => {
    const contract = sampleContract()
    const locale = 'app-shell.locale-select.option'

    screenIn(contract, 'app-shell').anchors['app-shell.locale-select'] = {
      kind: 'select',
      derived: ['option'],
    }
    contract.vocabulary.choiceValues[locale] = { en: 'English', es: 'Spanish' }
    sampleBinding(contract).search = {
      type: 'object',
      properties: {
        lang: {
          type: 'string',
          enum: ['en', 'fr', 'k', 'key', 'mode'],
          'x-perch': {
            values: {
              en: { control: locale, controlValue: 'en' },
              fr: { control: locale, controlValue: 'fr' },
              k: { control: 'sample.mode-select.option', controlValue: 'k12' },
              key: { control: 'sample.key-select.option', controlValue: 'k7' },
              mode: { control: 'sample.a-button', controlValue: 'a' },
            },
          },
        },
      },
      additionalProperties: false,
    }
    sampleBinding(contract).retain = []

    const values = `${AT}.search.properties.lang["x-perch"].values`

    expect(printed(contract)).toEqual([
      `${values}.fr.controlValue: "fr" is not a choice value of "${locale}"`,
      `${values}.k.controlValue: "k12" is not a choice value of "sample.mode-select.option"; it is one of "sample.key-select.option"`,
      `${values}.mode.controlValue: "a": "sample.a-button" has no choice values in the vocabulary`,
    ])
  })
  it('wants params and search to be valid JSON Schemas, naming the screen', () => {
    const contract = sampleContract()
    const binding = sampleBinding(contract)

    binding.params = {
      type: 'object',
      properties: { key: { type: 'string', pattern: '[' } },
      additionalProperties: false,
    }
    Object.assign(binding.search ?? {}, { required: ['tab', 'tab'] })

    expect(printed(contract)).toEqual([
      expect.stringMatching(
        /^contract\/screens\.json:1: screens\[1\]\.bindings\[0\]\.params: not a valid JSON Schema \(screen "sample"\): the schema does not compile: Invalid regular expression/,
      ),
      `${AT}.search: not a valid JSON Schema (screen "sample"): /required: must NOT have duplicate items (items ## 1 and 0 are identical)`,
    ])
  })
})
