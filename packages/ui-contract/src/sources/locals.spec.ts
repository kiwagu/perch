import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { localsOf } from './locals'
import { suppliedBy } from './spreads'
import { staticText } from './values'

/** The value `name` stands for where `marker` is written in `text`. */
function valueAt(text: string, name: string, marker: string): string | undefined {
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })

  return staticText(localsOf(program).valueNamed(name, text.indexOf(marker)))
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

describe('suppliedBy', () => {
  /** What the spread of `argument`, written at `marker` in `text`, supplies. */
  function supplied(text: string, argument: string, marker: string) {
    const { program } = parseSync('x.tsx', `${text}\nconst spread = ${argument}`, {
      lang: 'tsx',
      sourceType: 'module',
    })
    const declarator = program.body.at(-1)
    const value =
      declarator?.type === 'VariableDeclaration' ? declarator.declarations[0]?.init : undefined

    if (value === undefined || value === null) {
      throw new Error('the probe declares the spread')
    }

    return suppliedBy(localsOf(program), value, text.indexOf(marker))
  }

  /** The names of the props it supplies. */
  const suppliedAt = (text: string, argument: string, marker: string): string[] =>
    supplied(text, argument, marker).props.map(({ name }) => name)

  const text = [
    'const base = { id: 1 }',
    'const field = (name) => ({ ...base, name })',
    'function twice() { if (a) { return { a: 1 } } return { b: 2 } }',
    'function twoReturns() { return { a: 1 }; return { b: 2 } }',
    'const loop = () => ({ ...loop() })',
    'function nested() { const inner = () => { return { inner: 1 } }; return { outer: inner } }',
    'const groups = { email: { maxLength: 3 }, name: { id: 2 } }',
    'const memo = useMemo(() => ({ maxLength: 4 }), [])',
    'const wrapped = useCallback((name) => ({ name, type: name }), [])',
    'const at = 0',
  ].join('\n')

  it('follows a constant and a call of a function of the file through the spreads its object writes', () => {
    expect(suppliedAt(text, "field('x')", 'const at')).toEqual(['id', 'name'])
    expect(suppliedAt(text, '{ ...field(1), maxLength: 2 }', 'const at')).toEqual([
      'id',
      'name',
      'maxLength',
    ])
  })
  it('follows every return of a body, not of a function inside it, and both branches of a conditional', () => {
    expect(suppliedAt(text, 'twice()', 'const at')).toEqual(['a', 'b'])
    expect(suppliedAt(text, 'twoReturns()', 'const at')).toEqual(['a', 'b'])
    expect(suppliedAt(text, 'nested()', 'const at')).toEqual(['outer'])
    expect(suppliedAt(text, 'ok ? { maxLength: 1 } : base', 'const at')).toEqual([
      'maxLength',
      'id',
    ])
  })
  it('follows a member of an object, a useMemo value and a useCallback function, and the sides of && and ||', () => {
    expect(suppliedAt(text, 'groups.email', 'const at')).toEqual(['maxLength'])
    expect(suppliedAt(text, 'memo', 'const at')).toEqual(['maxLength'])
    expect(suppliedAt(text, "wrapped('x')", 'const at')).toEqual(['name', 'type'])
    expect(suppliedAt(text, 'ok && base', 'const at')).toEqual(['id'])
    expect(suppliedAt(text, 'base || groups.name', 'const at')).toEqual(['id', 'id'])
  })
  it('counts a prop as certain only where every branch supplies it, and says when a branch cannot be followed', () => {
    const either = supplied(
      text,
      'ok ? { maxLength: 1, id: 1 } : { ...base, maxLength: 2 }',
      'const at',
    )

    expect([...either.certain].sort()).toEqual(['id', 'maxLength'])
    expect(either.followed).toBe(true)

    const some = supplied(text, "{ ...(ok ? { 'aria-invalid': true } : {}), id: 1 }", 'const at')

    expect([...some.certain]).toEqual(['id'])
    expect(some.props.map(({ name }) => name)).toEqual(['aria-invalid', 'id'])
    expect(supplied(text, 'ok && base', 'const at').certain.size).toBe(0)
    expect(supplied(text, '{ ...props, id: 1 }', 'const at').followed).toBe(false)
    expect(supplied(text, 'ok ? base : props', 'const at').followed).toBe(false)
  })
  it('follows never a cycle, a parameter or a name the file does not declare', () => {
    expect(suppliedAt(text, 'loop()', 'const at')).toEqual([])
    expect(suppliedAt(text, 'props', 'const at')).toEqual([])
    expect(suppliedAt(text, 'elsewhere()', 'const at')).toEqual([])
  })
})
