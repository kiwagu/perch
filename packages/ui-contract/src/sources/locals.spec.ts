import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { localsOf } from './locals'
import { staticText } from './values'

/** The value `name` stands for where `marker` is written in `text`. */
function valueAt(text: string, name: string, marker: string): string | undefined {
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })

  return staticText(localsOf(program).valueOf(name, text.indexOf(marker)))
}

describe('localsOf', () => {
  const text = [
    "const KEY = 'outer'",
    "function a() { const KEY = 'inner'; return one(KEY) }",
    'function b(KEY) { return two(KEY) }',
    'function c() { const { KEY } = props; return three(KEY) }',
    'const d = (...KEY) => four(KEY)',
    'function e() { return five(KEY) }',
  ].join('\n')

  it('resolves a name to the declaration its scope sees, the innermost', () => {
    expect(valueAt(text, 'KEY', 'one(')).toBe('inner')
    expect(valueAt(text, 'KEY', 'five(')).toBe('outer')
  })
  it('lets a parameter or a destructured name hide an outer constant: it has no value of the file', () => {
    expect(valueAt(text, 'KEY', 'two(')).toBeUndefined()
    expect(valueAt(text, 'KEY', 'three(')).toBeUndefined()
    expect(valueAt(text, 'KEY', 'four(')).toBeUndefined()
  })
  it('resolves no name the file does not declare', () => {
    expect(valueAt(text, 'OTHER', 'five(')).toBeUndefined()
  })
})
