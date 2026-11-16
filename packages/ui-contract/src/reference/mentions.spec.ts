import { describe, expect, it } from 'vitest'

import { ruleIdsNamedIn } from './mentions'

describe('ruleIdsNamedIn', () => {
  it('reads the id that follows the word rule', () => {
    expect(ruleIdsNamedIn('Its values are those of the rule `address-key`.')).toEqual([
      'address-key',
    ])
    expect(ruleIdsNamedIn('An error shows beside its controls, rule `error-placement`)')).toEqual([
      'error-placement',
    ])
  })
  it('reads each id of a list, however its members are joined', () => {
    expect(ruleIdsNamedIn('The rule `pair-differs`, `pair-strays` or `pair-follows`.')).toEqual([
      'pair-differs',
      'pair-strays',
      'pair-follows',
    ])
    expect(ruleIdsNamedIn('The rules `a` and `b`, `c`.')).toEqual(['a', 'b', 'c'])
  })
  it('reads every place a text names one, in the order it writes them', () => {
    expect(
      ruleIdsNamedIn('See the rule `b`. Elsewhere, the rule `a`; once more, the rule `b`.'),
    ).toEqual(['b', 'a', 'b'])
  })
  it('names none where a word in backticks is no rule', () => {
    expect(ruleIdsNamedIn('The `roles` of a screen and its `renders`.')).toEqual([])
    expect(
      ruleIdsNamedIn('Its anchor is `rule-address-key`, and `rule` `address-key` is none.'),
    ).toEqual([])
    expect(ruleIdsNamedIn('A rule of the engine, and the rule that holds.')).toEqual([])
    expect(ruleIdsNamedIn('')).toEqual([])
  })
  it('stops a list at the first word that is not a member', () => {
    expect(ruleIdsNamedIn('The rule `a` or the `roles` it names.')).toEqual(['a'])
  })
})
