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
    'const common = { a: 1 }',
    'const fields = { ...common, ...{ email: { maxLength: 5 } } }',
    "const nameProps = { 'aria-invalid': true }",
    'const emailOverrides = { email: { maxLength: 3 } }',
    'const overrides = { ...emailOverrides }',
    'const grouped = { name: nameProps, ...overrides }',
    'const gated = { name: nameProps, ...{ ...(ok && emailOverrides) } }',
    'const opaque = { name: nameProps, ...{ ...props } }',
    'const first = { id: 1 }',
    "const second = { type: 'b' }",
    'const decided = { name: first, ...{ ...{ name: second } } }',
    "const fieldKey = 'name'",
    'const drafted = { name: nameProps, ...{ ...(ok ? { [fieldKey]: { maxLength: 3 } } : {}) } }',
    'const unsure = { name: nameProps, ...{ ...(ok ? { [props.fieldKey]: { maxLength: 3 } } : {}) } }',
    "const layoutKey = 'compact'",
    "const searchProps = { 'data-testid': 'x.search-input' }",
    'const inputProps = { search: searchProps, [layoutKey]: { size: 1 } }',
    'const unsureProps = { search: searchProps, [props.layout]: { size: 1 } }',
    "const LABEL_PROP = 'aria-label'",
    'function hidden(LABEL_PROP) { return { [LABEL_PROP]: 1 } }',
    "let prop = 'tabIndex'",
    "if (ok) prop = 'maxLength'",
    'const extra = { [prop]: 3 }',
    "var oldKey = 'maxLength'",
    'const viaVar = { [oldKey]: 3 }',
    'const { picked } = props',
    'const viaPicked = { [picked]: 3 }',
    'const getter = { name: nameProps, ...{ get name() { return { maxLength: 3 } } } }',
    'const setter = { name: nameProps, ...{ set name(value) {} } }',
    "const aside = { name: nameProps, ...{ get other() { return 1 }, ['x']: 2 } }",
    "const literal = { name: nameProps, ...{ ['name']: first } }",
    'const fieldOverrides = (level) => ({ ...(level > 0 ? fieldOverrides(level - 1) : emailOverrides) })',
    'const recursive = { name: nameProps, ...fieldOverrides(1) }',
    "const events = { reset: { type: 'r' } }",
    'const { reset: checkEvent } = events',
    'function early(c) { if (c) return; return { mark: 1 } }',
    'function maybe(c) { if (c) { return { mark: 1 } } }',
    'function both(c) { if (c) { return { mark: 1 } } else { return { mark: 2, id: 3 } } }',
    'function bare(c) { if (c) return { mark: 1 }; else return { mark: 2, id: 3 } }',
    'function chain(c) { if (c === 1) { return { mark: 1 } } else if (c === 2) { return { mark: 2 } } else { throw new Error() } }',
    'function oneArm(c) { if (c) { return { mark: 1 } } else { log() } }',
    'function noElse(c) { if (c) { return { mark: 1 } } else if (c === 2) { return { mark: 2 } } }',
    'function cases(c) { switch (c) { case 1: return { mark: 1 }; default: return { mark: 2 } } }',
    'async function asyncBoth(c) { if (c) { return { mark: 1 } } else { return { mark: 2 } } }',
    'function* generated() { yield 1; return { mark: 1 } }',
    'const asyncArrow = async () => ({ mark: 1 })',
    'const memoAsync = useMemo(async () => ({ mark: 1 }), [])',
    'const wrappedAsync = useCallback(async (name) => ({ name }), [])',
    'function viaAsync() { return { id: 1, ...asyncArrow() } }',
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
  it('follows a member through the spreads of its object, and a destructured name to its key', () => {
    expect(suppliedAt(text, 'fields.email', 'const at')).toEqual(['maxLength'])
    expect(supplied(text, 'fields.email', 'const at').followed).toBe(true)
    expect(suppliedAt(text, 'checkEvent', 'const at')).toEqual(['type'])
  })
  it('goes on to the property before a spread, at any depth, that lacks the key', () => {
    const nested = supplied(text, 'grouped.name', 'const at')

    expect(nested.props.map(({ name }) => name)).toEqual(['aria-invalid'])
    expect(nested.certain.has('aria-invalid')).toBe(true)
    expect(nested.followed).toBe(true)
    // Each branch of the spread, an object that lacks the key and nothing, goes on to it.
    expect(suppliedAt(text, 'gated.name', 'const at')).toEqual(['aria-invalid', 'aria-invalid'])
    expect(supplied(text, 'gated.name', 'const at').certain.has('aria-invalid')).toBe(true)
  })
  it('supplies nothing for a key no level has, and lets a nested branch that has the key decide', () => {
    expect(suppliedAt(text, 'grouped.other', 'const at')).toEqual([])
    expect(supplied(text, 'grouped.other', 'const at').certain.size).toBe(0)
    expect(supplied(text, 'grouped.other', 'const at').followed).toBe(true)
    expect(suppliedAt(text, 'decided.name', 'const at')).toEqual(['type'])
    expect(suppliedAt(text, 'grouped.email', 'const at')).toEqual(['maxLength'])
  })
  it('still says a nested branch it cannot follow cannot be followed, rather than going on past it', () => {
    expect(supplied(text, 'opaque.name', 'const at').followed).toBe(false)
  })
  it('leaves a member unknown where a property whose key it cannot read, or a getter or a setter, may supply it', () => {
    for (const member of ['unsure.name', 'getter.name', 'setter.name']) {
      const read = supplied(text, member, 'const at')

      expect(read.followed).toBe(false)
      expect(read.certain.has('aria-invalid')).toBe(false)
    }
  })
  it('reads a computed key that a constant of the file holds as that string, where the key is written', () => {
    const drafts = supplied(text, 'drafted.name', 'const at')

    // `[fieldKey]` is 'name': the override replaces the mark in one branch, and the other keeps it.
    expect(drafts.props.map(({ name }) => name)).toEqual(['maxLength', 'aria-invalid'])
    expect(drafts.followed).toBe(true)
    expect(drafts.certain.size).toBe(0)
    expect(suppliedAt(text, 'inputProps.search', 'const at')).toEqual(['data-testid'])
    expect(supplied(text, 'inputProps.search', 'const at').followed).toBe(true)
    expect(suppliedAt(text, 'inputProps.compact', 'const at')).toEqual(['size'])
    expect(suppliedAt(text, '{ [LABEL_PROP]: 1 }', 'const at')).toEqual(['aria-label'])
    expect(supplied(text, '{ [LABEL_PROP]: 1 }', 'const at').followed).toBe(true)
  })
  it('states a computed key only by a const: a let that is reassigned, a var and a destructured name are unknown', () => {
    for (const argument of ['extra', 'viaVar', 'viaPicked']) {
      expect(supplied(text, argument, 'const at').followed).toBe(false)
    }

    // The const of the same name is read.
    expect(suppliedAt(text, '{ [LABEL_PROP]: 1 }', 'const at')).toEqual(['aria-label'])
    expect(supplied(text, 'inputProps.search', 'const at').followed).toBe(true)
  })
  it('keeps a computed key it cannot state unknown: a parameter, a name the file does not declare, a member', () => {
    for (const argument of ['hidden(1)', '{ [imported]: 1 }', '{ [props.key]: 1 }']) {
      expect(supplied(text, argument, 'const at').followed).toBe(false)
    }
  })
  it('goes on past a key it cannot state, with the property before it as one more alternative', () => {
    const read = supplied(text, 'unsureProps.search', 'const at')

    expect(read.followed).toBe(false)
    expect(read.props.map(({ name }) => name)).toEqual(['data-testid'])
    expect(read.certain.size).toBe(0)
    expect([...read.followedCertain]).toEqual(['data-testid'])
  })
  it('says what every branch it can follow supplies, the ones it cannot follow left aside', () => {
    expect([
      ...supplied(text, 'ok ? { a: 1, b: 2 } : { a: 3 } ', 'const at').followedCertain,
    ]).toEqual(['a'])
    expect([...supplied(text, 'ok ? { a: 1 } : props', 'const at').followedCertain]).toEqual(['a'])
    expect(supplied(text, 'ok ? { a: 1 } : props', 'const at').certain.size).toBe(0)
    expect(supplied(text, 'ok && { a: 1 }', 'const at').followedCertain.size).toBe(0)
    expect(supplied(text, 'props', 'const at').followedCertain.size).toBe(0)
  })
  it('goes on past a property whose key it can read and that is not the key, a computed string literal included', () => {
    expect(suppliedAt(text, 'aside.name', 'const at')).toEqual(['aria-invalid'])
    expect(supplied(text, 'aside.name', 'const at').followed).toBe(true)
    expect(suppliedAt(text, 'literal.name', 'const at')).toEqual(['id'])
    expect(supplied(text, 'literal.name', 'const at').followed).toBe(true)
  })
  it('ends a helper that calls itself as unknown, never in a stack overflow', () => {
    const read = supplied(text, 'recursive.name', 'const at')

    expect(read.followed).toBe(false)
    expect(read.certain.has('aria-invalid')).toBe(false)
  })
  it('says an object it cannot read a key of cannot be followed: a computed key, a getter, a setter', () => {
    for (const argument of [
      '{ [limitKey]: 3 }',
      '{ id: 1, [`maxLength`]: 3 }',
      '{ get maxLength() { return 3 } }',
      '{ set maxLength(value) {} }',
    ]) {
      expect(supplied(text, argument, 'const at').followed).toBe(false)
    }
  })
  it('reads a computed string literal as its name and lets a method supply nothing', () => {
    const read = supplied(text, "{ ['maxLength']: 3, onChange() {}, id: 1 }", 'const at')

    expect(read.props.map(({ name }) => name)).toEqual(['maxLength', 'id'])
    expect(read.followed).toBe(true)
  })
  it('counts a bare return and a reachable end as supplying nothing', () => {
    expect(suppliedAt(text, 'early(1)', 'const at')).toEqual(['mark'])
    expect(supplied(text, 'early(1)', 'const at').certain.size).toBe(0)
    expect(supplied(text, 'maybe(1)', 'const at').certain.size).toBe(0)
  })
  it('counts the end of a body as unreachable when an if and its else both return, with or without braces', () => {
    for (const call of ['both(1)', 'bare(1)']) {
      const both = supplied(text, call, 'const at')

      expect(both.props.map(({ name }) => name)).toEqual(['mark', 'mark', 'id'])
      expect([...both.certain]).toEqual(['mark'])
      expect(both.followed).toBe(true)
    }
    // An `else if` chain that ends in a `throw` ends the body too.
    expect(suppliedAt(text, 'chain(1)', 'const at')).toEqual(['mark', 'mark'])
    expect([...supplied(text, 'chain(1)', 'const at').certain]).toEqual(['mark'])
  })
  it('still counts the end as reachable when an else arm does not return, or there is no final else', () => {
    expect(suppliedAt(text, 'oneArm(1)', 'const at')).toEqual(['mark'])
    expect(supplied(text, 'oneArm(1)', 'const at').certain.size).toBe(0)
    expect(supplied(text, 'noElse(1)', 'const at').certain.size).toBe(0)
  })
  it('still counts the end as reachable after a switch whose every case returns: the form is not read, so it is refused', () => {
    expect(suppliedAt(text, 'cases(1)', 'const at')).toEqual(['mark', 'mark'])
    expect(supplied(text, 'cases(1)', 'const at').certain.size).toBe(0)
  })
  it('does not follow what an async function or a generator returns, but still reads the objects its returns write', () => {
    // A Promise and an iterator are no object the file writes: nothing is certain, the call is
    // not followed, and what the returns write stays among the props.
    const calls: Array<[string, string[]]> = [
      ['asyncBoth(1)', ['mark', 'mark']],
      ['generated()', ['mark']],
      ['asyncArrow()', ['mark']],
      ['memoAsync', ['mark']],
      ["wrappedAsync('x')", ['name']],
    ]

    for (const [call, names] of calls) {
      const result = supplied(text, call, 'const at')

      expect(result.followed).toBe(false)
      expect(result.props.map(({ name }) => name)).toEqual(names)
      expect(result.certain.size).toBe(0)
      expect([...result.followedCertain]).toEqual([names[0]])
    }

    // A spread of such a call inside an object leaves the object not followed, its own props known.
    const via = supplied(text, 'viaAsync()', 'const at')

    expect(via.followed).toBe(false)
    expect(via.props.map(({ name }) => name)).toEqual(['id', 'mark'])
    expect([...via.certain]).toEqual(['id'])
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
