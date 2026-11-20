import { describe, expect, it } from 'vitest'

import { referenceSlug } from './slug'

describe('referenceSlug', () => {
  it('joins the parts by `-`, a map value written as its placeholder', () => {
    expect(referenceSlug('screen', 'anchors', '<name>', 'secret')).toBe(
      'screen-anchors-name-secret',
    )
  })
  it('writes the parts in lower case', () => {
    expect(referenceSlug('screen', 'anchors', '<name>', 'holdsInput')).toBe(
      'screen-anchors-name-holdsinput',
    )
  })
  it('writes every run of characters outside [a-z0-9] as one `-`, and none at either end', () => {
    expect(referenceSlug('manifest', '$schema')).toBe('manifest-schema')
    expect(referenceSlug('screen', 'anchors', '<name>')).toBe('screen-anchors-name')
    expect(referenceSlug('rule', 'x-perch', 'two  words')).toBe('rule-x-perch-two-words')
  })
})
