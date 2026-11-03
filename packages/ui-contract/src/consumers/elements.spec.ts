import { describe, expect, it } from 'vitest'

import { elementAnchors, type SelectorMatch } from './elements'

/** The attribute selectors the consumers check reads, as `collectFromTest` finds them. */
const SELECTOR = /\[data-(testid|code|state|value)=(["'])(.*?)\2\]/g

/** Each code, state or value selector of `joined` with the anchor it pairs with. */
const paired = (joined: string): Array<[string | undefined, string | undefined]> => {
  const matches: SelectorMatch[] = [...joined.matchAll(SELECTOR)].map((match) => ({
    kind: match[1] === 'testid' ? 'anchor' : match[1],
    value: match[3],
    at: match.index,
    end: match.index + match[0].length,
  }))
  const anchors = elementAnchors(joined, matches)

  return matches.flatMap(({ kind, value }, index) =>
    kind === 'anchor' ? [] : [[value, anchors[index]]],
  )
}

describe('elementAnchors', () => {
  it('pairs the attribute selectors of one element, before or after its data-testid', () => {
    expect(paired('[data-testid="a"][data-state="s"]')).toEqual([['s', 'a']])
    expect(paired('[data-code="c"][data-id="1"][data-testid="a"]')).toEqual([['c', 'a']])
    expect(paired('[data-testid="a"][data-state="s"], [data-testid="b"][data-state="t"]')).toEqual([
      ['s', 'a'],
      ['t', 'b'],
    ])
  })
  it('goes on with the element written before a :has(...) after its ), whatever the :has holds', () => {
    expect(paired('[data-testid="a"]:has([data-testid="b"])[data-state="s"]')).toEqual([['s', 'a']])
    expect(
      paired('[data-testid="a"]:has(> [data-testid="b"] + [data-code="c"])[data-state="s"]'),
    ).toEqual([
      ['c', undefined],
      ['s', 'a'],
    ])
    expect(paired('[data-state="s"]:has([data-testid="b"])[data-testid="a"]')).toEqual([['s', 'a']])
  })
  it('pairs what a :has(...) holds among itself, never with the element it is written on', () => {
    expect(paired('[data-testid="a"]:has([data-testid="b"][data-state="s"])')).toEqual([['s', 'b']])
    expect(paired('[data-testid="a"]:has([data-state="s"])')).toEqual([['s', undefined]])
  })
  it('reads a :not(...), :is(...) or :where(...) of one compound as the element itself, a data-testid in a :not naming none', () => {
    expect(paired('[data-testid="a"]:not([data-state="s"])')).toEqual([['s', 'a']])
    expect(paired('[data-code="c"]:not([data-testid="a"])')).toEqual([['c', undefined]])
    expect(paired('[data-testid="b"]:not([data-testid="a"])[data-code="c"]')).toEqual([['c', 'b']])
    expect(paired('[data-code="c"]:not(:is([data-testid="a"]))')).toEqual([['c', undefined]])
    expect(paired('[data-code="c"]:is([data-testid="a"])')).toEqual([['c', 'a']])
    expect(paired('[data-code="c"]:where([data-testid="a"][data-id="1"])')).toEqual([['c', 'a']])
  })
  it('reads a :not(...) or :is(...) holding a combinator or a list as other elements', () => {
    expect(paired('[data-testid="a"]:not([data-testid="b"] [data-state="s"])')).toEqual([
      ['s', undefined],
    ])
    expect(paired('[data-code="c"]:is([data-testid="a"], [data-testid="b"])')).toEqual([
      ['c', undefined],
    ])
  })
  it('goes on with the element after any other parenthesised argument, a ) in a quoted string included', () => {
    expect(paired('[data-testid="a"]:nth-child(2 of .x)[data-state="s"]')).toEqual([['s', 'a']])
    expect(paired('[data-testid="a"]:has-text("x) y")[data-state="s"]')).toEqual([['s', 'a']])
  })
  it('pairs nothing across a stray ), an unclosed (, other text or an expression', () => {
    expect(paired('[data-testid="a"])[data-state="s"]')).toEqual([['s', undefined]])
    expect(paired('[data-testid="a"]:has([data-state="s"]')).toEqual([['s', undefined]])
    expect(paired('[data-testid="a"].x[data-state="s"]')).toEqual([['s', undefined]])
    expect(paired('[data-testid="a"]\0[data-state="s"]')).toEqual([['s', undefined]])
  })
})
