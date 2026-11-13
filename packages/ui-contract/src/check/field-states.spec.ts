import { describe, expect, it } from 'vitest'

import type { AnchorDef, Vocabulary } from '../files'

import { sampleContract } from './contract.fixture'
import { fieldStatesOf, showsStoredValue } from './field-states'

const declaring: Vocabulary = {
  ...sampleContract().vocabulary,
  fieldStates: { unsaved: 'held, not yet saved', saved: 'what is stored' },
}
const without: Vocabulary = sampleContract().vocabulary

describe('fieldStatesOf', () => {
  it('gives a model-bound input both states', () => {
    const def: AnchorDef = { kind: 'input', holdsInput: true, binding: { model: 'profile.name' } }

    expect(fieldStatesOf(def, declaring)).toEqual(['unsaved', 'saved'])
  })
  it('gives an action-bound input only unsaved', () => {
    const def: AnchorDef = {
      kind: 'input',
      holdsInput: true,
      binding: { action: 'thing.createThing' },
    }

    expect(fieldStatesOf(def, declaring)).toEqual(['unsaved'])
  })
  it('gives a field that holds no input nothing', () => {
    const def: AnchorDef = { kind: 'select', holdsInput: false, binding: { model: 'profile.name' } }

    expect(fieldStatesOf(def, declaring)).toEqual([])
  })
  it('gives a checkbox and a button nothing', () => {
    expect(
      fieldStatesOf(
        { kind: 'checkbox', holdsInput: true, binding: { model: 'profile.name' } },
        declaring,
      ),
    ).toEqual([])
    expect(fieldStatesOf({ kind: 'button' }, declaring)).toEqual([])
  })
  it('gives nothing under a vocabulary without the section', () => {
    const def: AnchorDef = { kind: 'input', holdsInput: true, binding: { model: 'profile.name' } }

    expect(fieldStatesOf(def, without)).toEqual([])
  })
  it('gives only the states the vocabulary declares', () => {
    const def: AnchorDef = { kind: 'input', holdsInput: true, binding: { model: 'profile.name' } }
    const vocabulary = { ...declaring, fieldStates: { saved: 'what is stored' } }

    expect(fieldStatesOf(def, vocabulary)).toEqual(['saved'])
  })
})

describe('showsStoredValue', () => {
  it('holds for a binding list with a model ref', () => {
    const def: AnchorDef = {
      kind: 'textarea',
      holdsInput: true,
      binding: [{ action: 'thing.createThing' }, { model: 'profile.name' }],
    }

    expect(showsStoredValue(def)).toBe(true)
  })
  it('does not hold without a model ref, without held input or without a binding', () => {
    expect(
      showsStoredValue({ kind: 'input', holdsInput: true, binding: { search: 'email' } }),
    ).toBe(false)
    expect(
      showsStoredValue({ kind: 'input', holdsInput: false, binding: { model: 'profile.name' } }),
    ).toBe(false)
    expect(showsStoredValue({ kind: 'input', holdsInput: true })).toBe(false)
  })
})
