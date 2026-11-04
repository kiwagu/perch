import { describe, expect, it } from 'vitest'

import { anchorCarries } from './carries'
import { anchorIn, sampleContract, screenIn } from './contract.fixture'

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
