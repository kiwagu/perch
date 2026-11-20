import { describe, expect, it } from 'vitest'

import { concernsOf } from './concerns'

type Code = 'name-required' | 'name-too-long' | 'bio-too-long' | 'failed'

const FIELDS: Partial<Record<Code, 'name' | 'bio'>> = {
  'name-required': 'name',
  'name-too-long': 'name',
  'bio-too-long': 'bio',
}

describe('concernsOf', () => {
  it('gives the field a mapped code concerns', () => {
    expect(concernsOf(FIELDS, 'name-required')).toBe('name')
    expect(concernsOf(FIELDS, 'name-too-long')).toBe('name')
    expect(concernsOf(FIELDS, 'bio-too-long')).toBe('bio')
  })

  it('gives no field for a code the map leaves out, which concerns the form', () => {
    expect(concernsOf(FIELDS, 'failed')).toBeUndefined()
  })

  it('gives no field while no error shows', () => {
    expect(concernsOf(FIELDS, undefined)).toBeUndefined()
  })

  it('gives no field from an empty map', () => {
    expect(concernsOf<Code, 'name'>({}, 'name-required')).toBeUndefined()
  })
})
