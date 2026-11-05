import { describe, expect, it } from 'vitest'

import type { Contract } from '../check'
import { sampleContract } from '../check/contract.fixture'
import type { WrittenDescription } from '../files'

import { descriptionChanges } from './description-changes'

const FRAME = 'contract/domain/screens/__root.yaml'

/** A written description of the frame at `place`, an anchor's unless `kind` says otherwise. */
const written = (
  place: string,
  text: string,
  kind: WrittenDescription['kind'] = 'anchor',
): WrittenDescription => ({ file: FRAME, line: 1, at: [], kind, place, text })

const contractWith = (...descriptions: WrittenDescription[]): Contract => ({
  ...sampleContract(),
  descriptions,
})

describe('descriptionChanges', () => {
  it('lists each description changed, added or removed, by its place, with its length on each side', () => {
    expect(
      descriptionChanges(
        contractWith(
          written('app-shell.theme-select', 'x'.repeat(191)),
          written('app-shell.status', 'The readiness line.'),
          written('app-shell flow ready', 'y'.repeat(340), 'state'),
        ),
        contractWith(
          written('app-shell.theme-select', 'x'.repeat(340)),
          written('app-shell.status', 'The readiness line.'),
          written('app-shell state ready', 'z'.repeat(120), 'containerState'),
        ),
        [],
      ),
    ).toEqual([
      { place: 'app-shell flow ready', before: 340 },
      { place: 'app-shell state ready', after: 120 },
      { place: 'app-shell.theme-select', before: 191, after: 340 },
    ])
  })
  it('lists a shrink, and a text changed at the same length', () => {
    expect(
      descriptionChanges(
        contractWith(written('a.one-button', 'x'.repeat(340)), written('a.two-button', 'Saves.')),
        contractWith(written('a.one-button', 'x'.repeat(191)), written('a.two-button', 'Sends.')),
        [],
      ),
    ).toEqual([
      { place: 'a.one-button', before: 340, after: 191 },
      { place: 'a.two-button', before: 6, after: 6 },
    ])
  })
  it("holds a renamed anchor's description under its new name", () => {
    const before = contractWith(written('sample.save-button', 'Saves the thing.'))
    const renamed = [{ from: 'sample.save-button', to: 'sample.store-button' }]

    expect(
      descriptionChanges(
        before,
        contractWith(written('sample.store-button', 'Saves the thing.')),
        renamed,
      ),
    ).toEqual([])
    expect(
      descriptionChanges(
        before,
        contractWith(written('sample.store-button', 'Stores it.')),
        renamed,
      ),
    ).toEqual([{ place: 'sample.store-button', before: 16, after: 10 }])
  })
  it('takes a missing contract as one without descriptions', () => {
    expect(
      descriptionChanges(undefined, contractWith(written('sample.page', 'The root.')), []),
    ).toEqual([{ place: 'sample.page', after: 9 }])
  })
})
