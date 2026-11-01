import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import { anchorIn, sampleContract, screenIn } from './contract.fixture'
import { vocabularyProblems } from './vocabulary'

const printed = (contract = sampleContract()): string[] =>
  vocabularyProblems(contract).map(formatProblem)

describe('vocabularyProblems', () => {
  it('finds nothing in a consistent contract', () => {
    expect(printed()).toEqual([])
  })
  it('names a kind, a suffix, a code, a state and a role the vocabulary does not list', () => {
    const contract = sampleContract()

    Object.assign(anchorIn(contract, 'sample.page'), {
      kind: 'pane',
      derived: ['close-button'],
      codes: ['gone'],
      states: ['busy'],
      roles: ['owner'],
    })

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].kind: "pane" is not a kind of the vocabulary',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].derived[0]: "close-button" is not a derived suffix of the vocabulary',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].codes[0]: "gone" is not a code of the vocabulary',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].states[0]: "busy" is not a state of the vocabulary',
      'contract/domain/screens/sample/$key.yaml:1: anchors["sample.page"].roles[0]: "owner" is not a role of the vocabulary',
    ])
  })
  it('checks the roles of bindings and platform actions and the codes of actions', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')
    const action = contract.screens.platform.actions['devices.list']

    Object.assign(sample.bindings[0] ?? {}, { roles: ['visitor'] })
    Object.assign(action ?? {}, { roles: ['root'], codes: ['devices-read-failed', 'nope'] })

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: bindings[0].roles[0]: "visitor" is not a role of the vocabulary',
      'contract/domain/platform.yaml:1: actions["devices.list"].roles[0]: "root" is not a role of the vocabulary',
      'contract/domain/platform.yaml:1: actions["devices.list"].codes[1]: "nope" is not a code of the vocabulary',
    ])
  })
  it('names a screen id and an anchor prefix that are not screen names', () => {
    const contract = sampleContract()
    const sample = screenIn(contract, 'sample')

    sample.id = 'other'
    sample.anchors['stray.thing-button'] = { kind: 'button' }

    expect(printed(contract)).toEqual([
      'contract/domain/screens/sample/$key.yaml:1: id: "other" is not a screen name of the vocabulary',
      'contract/domain/screens/sample/$key.yaml:1: anchors["stray.thing-button"]: starts with no screen name of the vocabulary',
    ])
  })
  it('wants every choice-values anchor to exist and a pattern to be its only row', () => {
    const contract = sampleContract()

    contract.vocabulary.choiceValues['sample.gone-select.option'] = { x: 'x' }
    contract.vocabulary.choiceValues['sample.key-select.option'] = { '^k$': 'a key', k: 'k' }
    contract.vocabulary.choiceValues['sample.mode-select.option'] = { '^(': 'broken' }

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: choice values of "sample.mode-select.option": "^(" is not a valid pattern',
      'contract/vocabulary.md:1: choice values of "sample.key-select.option": a pattern is the only row of its anchor',
      'contract/vocabulary.md:1: choice values of "sample.gone-select.option": no such anchor in the screens',
    ])
  })
  it('refuses choice values for a visibility-button, whose values are its suffix own', () => {
    const contract = sampleContract()

    anchorIn(contract, 'sample.title-input').derived = ['visibility-button']
    contract.vocabulary.choiceValues['sample.title-input.visibility-button'] = { show: 'shows it' }

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: choice values of "sample.title-input.visibility-button": a visibility-button carries show or hide, the values of its suffix, and takes no rows',
    ])
  })
  it('reports a code no anchor or platform action uses', () => {
    const contract = sampleContract()

    contract.vocabulary.codes['spare'] = { where: 'nowhere', meaning: 'nothing' }

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: code "spare" is documented but unused',
    ])
  })
  it('asks no row of a derived toast code, but the rule row once one is derived', () => {
    const contract = sampleContract()
    const toast = anchorIn(contract, 'sample.save-button')

    Object.assign(toast, { codes: [...(toast.codes ?? []), 'thing-created'] })
    contract.screens.toasts = [
      { anchor: 'sample.save-button', code: 'thing-created', action: 'thing.createThing' },
    ]

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: section "Codes": the toasts derived on sample.save-button (thing-created) want the rule row `<object>-<verb>ed`',
    ])

    contract.vocabulary.codes['<object>-<verb>ed'] = {
      where: 'sample.save-button',
      meaning: 'the success of an action of the model',
    }

    expect(printed(contract)).toEqual([])
  })
  it('calls the rule row unused when no toast is derived', () => {
    const contract = sampleContract()

    contract.vocabulary.codes['<object>-<verb>ed'] = {
      where: 'app-shell.toast',
      meaning: 'the success of an action of the model',
    }

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: code "<object>-<verb>ed" is documented but unused',
    ])
  })
  it('wants the platform status states to equal the app states', () => {
    const contract = sampleContract()

    contract.screens.platform.status.states = ['ready', 'opening']

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: status.states: must equal the app states of the vocabulary, in order: opening, ready',
    ])
  })
  it('wants the platform reserved anchors to equal the vocabulary ones, each on app-shell', () => {
    const contract = sampleContract()

    contract.screens.platform.reserved = ['sample.page', 'app-shell.nav']
    contract.vocabulary.reserved['app-shell.nav'] = 'the navigation'

    expect(printed(contract)).toEqual([
      'contract/domain/platform.yaml:1: reserved: misses the reserved anchor "app-shell.status" of the vocabulary',
      'contract/domain/platform.yaml:1: reserved[0]: "sample.page" is not a reserved anchor of the vocabulary',
      'contract/domain/platform.yaml:1: reserved[0]: "sample.page" is not an anchor of the app-shell screen',
      'contract/domain/platform.yaml:1: reserved[1]: "app-shell.nav" is not an anchor of the app-shell screen',
    ])
  })
  it('takes a choice-values anchor derived only through a suffix its base lists in derived', () => {
    const contract = sampleContract()

    contract.vocabulary.choiceValues['sample.save-button.option'] = { x: 'x' }

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: choice values of "sample.save-button.option": no such anchor in the screens',
    ])
  })
  it('wants every permission role of the model to be a role of the vocabulary', () => {
    const contract = sampleContract()
    const thing = contract.model.entities['thing']

    contract.vocabulary.roles['admin'] = 'an administrator'
    Object.assign(thing ?? {}, {
      can: {
        member: { create: 'any', update: 'own', delete: 'own' },
        admin: { create: 'any', update: 'any', delete: 'any' },
        memebr: { update: 'own' },
      },
    })

    expect(printed(contract)).toEqual([
      'contract/domain/model.schema.json:1: $defs.thing["x-perch"].can.memebr: "memebr" is not a role of the vocabulary',
    ])
  })
})

describe('the questions before destructive actions', () => {
  const RULE = {
    where: 'app-shell.confirmation',
    meaning: 'the question before a destructive action',
  }

  it('asks no row of a derived question code, but the rule row once one is derived', () => {
    const contract = sampleContract()
    const dialog = anchorIn(contract, 'sample.save-button')

    Object.assign(dialog, { codes: [...(dialog.codes ?? []), 'thing-delete'] })
    contract.screens.questions = [
      { anchor: 'sample.save-button', code: 'thing-delete', action: 'thing.deleteThing' },
    ]

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: section "Codes": the questions derived on sample.save-button (thing-delete) want the rule row `<object>-<verb>`',
    ])

    contract.vocabulary.codes['<object>-<verb>'] = RULE

    expect(printed(contract)).toEqual([])
  })

  it('calls the rule row unused when no question is derived', () => {
    const contract = sampleContract()

    contract.vocabulary.codes['<object>-<verb>'] = RULE

    expect(printed(contract)).toEqual([
      'contract/vocabulary.md:1: code "<object>-<verb>" is documented but unused',
    ])
  })
})
