import { describe, expect, it } from 'vitest'

import { parseTypeString } from './type-string'

const S = (name: string) => ({ kind: 'scalar', name })

describe('parseTypeString', () => {
  it('reads scalars, options, records, arrays and literals', () => {
    expect(parseTypeString('string')).toEqual(S('string'))
    expect(parseTypeString('none | string')).toEqual({ kind: 'option', inner: S('string') })
    expect(parseTypeString('option<int>')).toEqual({ kind: 'option', inner: S('int') })
    expect(parseTypeString('record<identity>')).toEqual({ kind: 'record', tables: ['identity'] })
    expect(parseTypeString('record<identity | org>')).toEqual({
      kind: 'record',
      tables: ['identity', 'org'],
    })
    expect(parseTypeString('array<record<identity>>')).toEqual({
      kind: 'array',
      inner: { kind: 'record', tables: ['identity'] },
    })
    expect(parseTypeString('set<string>')).toEqual({ kind: 'array', inner: S('string') })
    expect(parseTypeString("'member' | 'admin'")).toEqual({
      kind: 'literal',
      values: ['member', 'admin'],
    })
    expect(parseTypeString('none | object')).toEqual({
      kind: 'option',
      inner: { kind: 'object', fields: {} },
    })
    expect(parseTypeString('bytes')).toEqual(S('bytes'))
  })

  it('treats anything it does not model as any', () => {
    expect(parseTypeString('geometry<point>')).toEqual(S('any'))
  })
})
