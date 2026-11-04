import { describe, expect, it } from 'vitest'

import { annotatedReadonlyFields } from './readonly-fields'

const fields = [{ name: 'identity' }, { name: 'name' }, { name: 'email' }]

const annotated = (lines: Readonly<Record<string, readonly string[]>>) =>
  new Map(
    Object.entries(lines).map(([field, values]) => [
      `profile.${field}`,
      new Map([['readonly', values]]),
    ]),
  )

describe('annotatedReadonlyFields', () => {
  it('lists the annotated fields in the order the structure gives them', () => {
    const problems: string[] = []

    expect(
      annotatedReadonlyFields(
        'profile',
        fields,
        annotated({ email: [''], identity: [''] }),
        true,
        problems,
      ),
    ).toEqual(['identity', 'email'])
    expect(problems).toEqual([])
  })

  it('reports a value after the annotation, which takes none', () => {
    const problems: string[] = []

    expect(
      annotatedReadonlyFields('profile', fields, annotated({ email: ['yes'] }), true, problems),
    ).toEqual([])
    expect(problems).toEqual(['table profile: field email: -- @readonly takes no value, got "yes"'])
  })

  it('reports the annotation on a table that is not replicated', () => {
    const problems: string[] = []

    expect(
      annotatedReadonlyFields('profile', fields, annotated({ email: [''] }), false, problems),
    ).toEqual([])
    expect(problems).toEqual([
      'table profile: field email: -- @readonly needs a replicated table (-- @region)',
    ])
  })

  it('reports the annotation on a nested or wildcard field, which a device cannot be refused', () => {
    const problems: string[] = []

    expect(
      annotatedReadonlyFields(
        'profile',
        [{ name: 'address' }, { name: 'address.city' }, { name: 'tags.*' }],
        annotated({ 'address.city': [''], 'tags.*': [''] }),
        true,
        problems,
      ),
    ).toEqual([])
    expect(problems).toEqual([
      'table profile: field address.city: -- @readonly marks a top-level field only',
      'table profile: field tags.*: -- @readonly marks a top-level field only',
    ])
  })

  it('answers with nothing for a table without the annotation', () => {
    expect(annotatedReadonlyFields('profile', fields, new Map(), true, [])).toEqual([])
  })
})
