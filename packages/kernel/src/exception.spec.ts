import { describe, expect, it } from 'vitest'

import { ExceptionBase } from './exception'
import { applyRules, type DomainRule } from './rules'

class NameRequiredException extends ExceptionBase {
  readonly code = 'profile:NAME_REQUIRED'
}

describe('ExceptionBase', () => {
  it('carries a stable code and the subclass name', () => {
    const error = new NameRequiredException('name is required')

    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('profile:NAME_REQUIRED')
    expect(error.name).toBe('NameRequiredException')
    expect(error.message).toBe('name is required')
  })
})

describe('applyRules', () => {
  const rules: readonly DomainRule<string>[] = [
    { code: 'profile:NAME_REQUIRED', isSatisfiedBy: (name) => name.trim() !== '' },
    { code: 'profile:NAME_TOO_LONG', isSatisfiedBy: (name) => name.length <= 5 },
  ]

  it('passes the value through when every rule holds', () => {
    expect(applyRules('Ann', rules)._unsafeUnwrap()).toBe('Ann')
  })

  it('reports every broken rule by code', () => {
    expect(applyRules('      ', rules)._unsafeUnwrapErr()).toEqual([
      { code: 'profile:NAME_REQUIRED' },
      { code: 'profile:NAME_TOO_LONG' },
    ])
  })
})
