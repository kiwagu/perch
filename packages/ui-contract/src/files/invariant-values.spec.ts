import { describe, expect, it } from 'vitest'

import { renderedRule, renderedValue } from './invariant-values'

describe('renderedValue', () => {
  it('writes a count as digits and a duration with its unit', () => {
    expect(renderedValue(10)).toBe('10')
    expect(renderedValue({ minutes: 15 })).toBe('15 minutes')
    expect(renderedValue({ minutes: 1 })).toBe('1 minute')
    expect(renderedValue({ seconds: 10 })).toBe('10 seconds')
    expect(renderedValue({ hours: 1 })).toBe('1 hour')
  })
})

describe('renderedRule', () => {
  it('writes each value into the rule where it names it, as often as it does', () => {
    expect(
      renderedRule({
        rule: '{limit} wrong passwords within {window}; the {limit} first count.',
        refuses: 'rate-limited',
        values: { limit: 10, window: { minutes: 15 } },
      }),
    ).toBe('10 wrong passwords within 15 minutes; the 10 first count.')
  })
  it('leaves a rule with no values, and a placeholder naming none, as written', () => {
    expect(renderedRule({ rule: 'Ten at most, {x}.', refuses: 'device-limit' })).toBe(
      'Ten at most, {x}.',
    )
    expect(
      renderedRule({ rule: '{limit} and {other}.', refuses: 'device-limit', values: { limit: 3 } }),
    ).toBe('3 and {other}.')
  })
})
