import { describe, expect, it } from 'vitest'

import { anchorCarries } from './carries'
import { anchorIn, sampleContract, screenIn } from './contract.fixture'
import { referenceResolver } from './scenarios'

describe('anchorCarries', () => {
  it('reads the codes, the states and the choice values an anchor declares', () => {
    const carries = anchorCarries(sampleContract())

    expect(carries('sample.save-button', 'code', 'saved')).toBe(true)
    expect(carries('sample.save-button', 'code', 'devices-read-failed')).toBe(false)
    expect(carries('sample.thing-item', 'state', 'current')).toBe(true)
    expect(carries('sample.list', 'state', 'current')).toBe(false)
    expect(carries('app-shell.status', 'state', 'ready')).toBe(true)
    expect(carries('app-shell.status', 'state', 'loading')).toBe(false)
    expect(carries('sample.mode-select.option', 'value', 'a')).toBe(true)
    expect(carries('sample.mode-select.option', 'value', 'k12')).toBe(false)
  })
  it('matches a value against a pattern row', () => {
    const carries = anchorCarries(sampleContract())

    expect(carries('sample.key-select.option', 'value', 'k12')).toBe(true)
    expect(carries('sample.key-select.option', 'value', 'a')).toBe(false)
  })
  it('reads what the anchors under it carry: the items of a list, the options of a select', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').anchors['sample.list.first-item'] = {
      kind: 'item',
      states: ['current'],
      codes: ['saved'],
    }

    const carries = anchorCarries(contract)

    expect(carries('sample.list', 'state', 'current')).toBe(true)
    expect(carries('sample.list', 'code', 'saved')).toBe(true)
    expect(carries('sample.mode-select', 'value', 'b')).toBe(true)
    expect(carries('sample.key-select', 'value', 'k7')).toBe(true)
    expect(carries('sample.key-select', 'value', 'b')).toBe(false)
  })
  it('reads no anchor whose id only begins with the same letters', () => {
    const contract = sampleContract()

    screenIn(contract, 'sample').anchors['sample.list-message'] = {
      kind: 'message',
      codes: ['saved'],
    }

    expect(anchorCarries(contract)('sample.list', 'code', 'saved')).toBe(false)
  })
  it('gives a visibility-button show and hide, and the input that renders it through it', () => {
    const contract = sampleContract()
    const before = anchorCarries(contract)

    expect(before('sample.title-input.visibility-button', 'value', 'show')).toBe(false)
    expect(before('sample.title-input', 'value', 'hide')).toBe(false)

    anchorIn(contract, 'sample.title-input').derived = ['visibility-button']

    const carries = anchorCarries(contract)

    expect(carries('sample.title-input.visibility-button', 'value', 'show')).toBe(true)
    expect(carries('sample.title-input.visibility-button', 'value', 'hide')).toBe(true)
    expect(carries('sample.title-input', 'value', 'show')).toBe(true)
    expect(carries('sample.save-button', 'value', 'show')).toBe(false)
    expect(carries('sample.title-input.visibility-button', 'value', 'a')).toBe(false)
  })
  it('reads the codes the loader wrote on an anchor as its own', () => {
    const contract = sampleContract()

    contract.screens.toasts = [
      { anchor: 'sample.save-button', code: 'thing-created', action: 'thing.createThing' },
    ]
    screenIn(contract, 'app-shell').anchors['app-shell.toast'] = {
      kind: 'toast',
      codes: ['thing-created'],
    }

    const carries = anchorCarries(contract)

    expect(carries('app-shell.toast', 'code', 'thing-created')).toBe(true)
    expect(carries('sample.save-button', 'code', 'thing-created')).toBe(false)
  })
})

describe('the field states of a field', () => {
  it('a field carries the field states the contract derives for it', () => {
    const contract = sampleContract()

    contract.vocabulary.fieldStates = { unsaved: 'held, not yet saved', saved: 'what is stored' }
    anchorIn(contract, 'sample.title-input').holdsInput = true
    screenIn(contract, 'sample').anchors['sample.email-input'] = {
      kind: 'input',
      holdsInput: true,
      binding: { action: 'thing.createThing' },
    }

    const carries = anchorCarries(contract)

    expect(carries('sample.title-input', 'state', 'saved')).toBe(true)
    expect(carries('sample.title-input', 'state', 'unsaved')).toBe(true)
    expect(carries('sample.email-input', 'state', 'unsaved')).toBe(true)
    expect(carries('sample.email-input', 'state', 'saved')).toBe(false)
    expect(carries('sample.save-button', 'state', 'saved')).toBe(false)
  })
  it('never takes a field state from what an anchor writes', () => {
    const contract = sampleContract()

    contract.vocabulary.fieldStates = { unsaved: 'held, not yet saved', saved: 'what is stored' }

    const anchors = screenIn(contract, 'sample').anchors

    anchors['sample.note-input'] = {
      kind: 'input',
      holdsInput: true,
      binding: { action: 'thing.createThing' },
      states: ['saved'],
    }
    anchors['sample.flag-button'] = { kind: 'button', states: ['unsaved'] }
    anchors['sample.plain-select'] = {
      kind: 'select',
      holdsInput: false,
      binding: { model: 'thing.title' },
      states: ['saved'],
    }

    const carries = anchorCarries(contract)

    expect(carries('sample.note-input', 'state', 'saved')).toBe(false)
    expect(carries('sample.note-input', 'state', 'unsaved')).toBe(true)
    expect(carries('sample.flag-button', 'state', 'unsaved')).toBe(false)
    expect(carries('sample.plain-select', 'state', 'saved')).toBe(false)
  })
  it('gives a parent the field states of the fields under it, and no sibling that only shares a prefix', () => {
    const contract = sampleContract()

    contract.vocabulary.fieldStates = { unsaved: 'held, not yet saved', saved: 'what is stored' }

    const anchors = screenIn(contract, 'sample').anchors

    anchors['sample.name-form'] = { kind: 'form' }
    anchors['sample.name-form.name-input'] = {
      kind: 'input',
      holdsInput: true,
      binding: { model: 'thing.title' },
    }
    anchors['sample.name-form-hint'] = { kind: 'message' }

    const carries = anchorCarries(contract)

    expect(carries('sample.name-form', 'state', 'saved')).toBe(true)
    expect(carries('sample.name-form-hint', 'state', 'saved')).toBe(false)
  })
  it('still reads a container state and a row state from what is written', () => {
    const carries = anchorCarries(sampleContract())

    expect(carries('sample.list', 'state', 'loading')).toBe(true)
    expect(carries('sample.thing-item', 'state', 'current')).toBe(true)
  })
})

describe('the page sizes of a paged list', () => {
  /** The sample with a paged list of devices, whose action pages by 10 or 25. */
  function paged(): ReturnType<typeof sampleContract> {
    const contract = sampleContract()
    const action = contract.screens.platform.actions['devices.list']

    Object.assign(action ?? {}, { paged: { sizes: [10, 25], default: 25 } })
    Object.assign(anchorIn(contract, 'sample.devices-list'), {
      source: { platform: 'devices.list', paged: true },
      derived: ['range', 'previous-link', 'next-link', 'size-select'],
    })

    return contract
  }

  it('are the values the options of its size select carry, and the list with them', () => {
    const carries = anchorCarries(paged())

    expect(carries('sample.devices-list.size-select.option', 'value', '10')).toBe(true)
    expect(carries('sample.devices-list.size-select', 'value', '25')).toBe(true)
    expect(carries('sample.devices-list', 'value', '25')).toBe(true)
    expect(carries('sample.devices-list.size-select.option', 'value', '50')).toBe(false)
    expect(carries('sample.mode-select.option', 'value', '10')).toBe(false)
  })

  it('are known as anchors and values of the contract, which no list that does not page has', () => {
    const resolve = referenceResolver(paged())
    const option = 'sample.devices-list.size-select.option'

    expect(resolve({ kind: 'anchor', value: option, raw: option })).toBeUndefined()
    expect(resolve({ kind: 'value', value: '10', raw: '10' })).toBeUndefined()
    expect(resolve({ kind: 'value', value: '30', raw: '30' })).toBe(
      '30 is not a choice value of the vocabulary',
    )

    const plain = referenceResolver(sampleContract())

    expect(plain({ kind: 'anchor', value: option, raw: option })).toBe(
      `${option} is not a declared anchor`,
    )
    expect(plain({ kind: 'value', value: '10', raw: '10' })).toBe(
      '10 is not a choice value of the vocabulary',
    )
  })
})
