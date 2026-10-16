import { describe, expect, it } from 'vitest'

import { type ChangeSpec, isSatisfiedBy, type QuerySpec, resolveValue } from './spec'

describe('QuerySpec', () => {
  const record = { name: 'Ann', locale: 'en', age: 30 }

  it('evaluates equality and its boolean combinations in memory', () => {
    const named: QuerySpec = { kind: 'eq', field: 'name', value: 'Ann' }
    const spanish: QuerySpec = { kind: 'eq', field: 'locale', value: 'es' }

    expect(isSatisfiedBy(named, record)).toBe(true)
    expect(isSatisfiedBy({ kind: 'and', specs: [named, spanish] }, record)).toBe(false)
    expect(isSatisfiedBy({ kind: 'or', specs: [named, spanish] }, record)).toBe(true)
    expect(isSatisfiedBy({ kind: 'not', spec: spanish }, record)).toBe(true)
  })
})

describe('ChangeSpec values', () => {
  const now = new Date('2026-01-01T00:00:00Z')

  it('resolves parameters, literals and the clock', () => {
    const params = { name: 'Ann' }

    expect(resolveValue({ param: 'name' }, params, () => now)).toBe('Ann')
    expect(resolveValue({ literal: 3 }, params, () => now)).toBe(3)
    expect(resolveValue({ now: true }, params, () => now)).toEqual(now)
  })

  it('describes a whole change as plain data', () => {
    const plan: readonly ChangeSpec[] = [
      { op: 'create', record: 'id', fields: { name: { param: 'name' } } },
      { op: 'set', record: 'id', field: 'bio', value: { literal: 'hi' } },
      { op: 'text.update', record: 'id', field: 'bio', value: { param: 'bio' } },
      { op: 'unset', record: 'id', field: 'locale' },
      { op: 'delete', record: 'id' },
    ]

    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan)
  })
})
