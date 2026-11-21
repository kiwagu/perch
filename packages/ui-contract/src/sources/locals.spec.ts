import { parseSync, type TSType } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { localsOf } from './locals'
import { suppliedBy } from './spreads'
import { staticText } from './values'

/** The value `name` stands for where `marker` is written in `text`, or the one a `const` holds. */
function valueAt(
  text: string,
  name: string,
  marker: string,
  lookup: 'valueNamed' | 'constantNamed' = 'valueNamed',
): string | undefined {
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })

  return staticText(localsOf(program)[lookup](name, text.indexOf(marker)))
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
  it('gives a loop and a catch their own scope: the name each binds hides an outer one there, and only there', () => {
    const scoped = [
      "const prop = 'data-testid'",
      "for (const prop of ['aria-label'] as const) { one(prop) }",
      'for (const prop in labels) two(prop)',
      "for (const prop = 'aria-label'; ok; ) { three(prop) }",
      'try { run() } catch (prop) { four(prop) }',
      'try { run() } catch ({ prop }) { five(prop) }',
      'try { run() } catch { six(prop) }',
      "function g() { for (var prop = 'aria-label'; ok; ) {} seven(prop) }",
      'eight(prop)',
    ].join('\n')

    // A loop's variable and a catch parameter have no value the file declares.
    for (const marker of ['one(', 'two(', 'four(', 'five(']) {
      expect(valueAt(scoped, 'prop', marker)).toBeUndefined()
      expect(valueAt(scoped, 'prop', marker, 'constantNamed')).toBeUndefined()
    }

    // A const in a loop's head holds its value in the loop.
    expect(valueAt(scoped, 'prop', 'three(', 'constantNamed')).toBe('aria-label')
    // A var in a loop's head binds around the loop, and is no const.
    expect(valueAt(scoped, 'prop', 'seven(')).toBe('aria-label')
    expect(valueAt(scoped, 'prop', 'seven(', 'constantNamed')).toBeUndefined()
    // After a loop or a catch, and in a catch that binds nothing, the outer const holds.
    expect(valueAt(scoped, 'prop', 'six(', 'constantNamed')).toBe('data-testid')
    expect(valueAt(scoped, 'prop', 'eight(', 'constantNamed')).toBe('data-testid')
  })
  it('gives the cases of a switch and a class static block their own scope for a let or a const', () => {
    const scoped = [
      "const prop = 'data-testid'",
      "switch (one(prop)) { case 'a': const prop = 'aria-label'; two(prop); break; default: three(prop) }",
      'four(prop)',
      "class A { static { const prop = 'aria-label'; five(prop) } }",
      'six(prop)',
      "function g() { switch (mode) { case 'a': let held = 'aria-label'; seven(held) } eight(held) }",
    ].join('\n')

    // A case's `const` binds in the block of the cases, every case of it, not in the discriminant.
    expect(valueAt(scoped, 'prop', 'two(', 'constantNamed')).toBe('aria-label')
    expect(valueAt(scoped, 'prop', 'three(', 'constantNamed')).toBe('aria-label')
    expect(valueAt(scoped, 'prop', 'five(', 'constantNamed')).toBe('aria-label')
    expect(valueAt(scoped, 'held', 'seven(')).toBe('aria-label')

    for (const marker of ['one(', 'four(', 'six(']) {
      expect(valueAt(scoped, 'prop', marker, 'constantNamed')).toBe('data-testid')
    }

    expect(valueAt(scoped, 'held', 'eight(')).toBeUndefined()
  })
  it('binds a var in the body of the function around it, a class static block or the file, wherever it is written', () => {
    const scoped = [
      "const prop = 'data-testid'",
      "function a() { switch (mode) { default: var prop = 'aria-label' } one(prop) }",
      "function b() { class B { static { { var prop = 'aria-label' } two(prop) } } three(prop) }",
      "function c() { for (var prop = 'aria-label'; ok; ) {} four(prop) }",
      "function d() { if (ok) { var prop = 'aria-label' } five(prop) }",
      "function e() { try { run() } catch (error) { var prop = 'aria-label' } six(prop) }",
      "function f() { for (const item of items) var prop = 'aria-label'; seven(prop) }",
      "function g(render = () => eight(prop)) { { var prop = 'aria-label' } nine(prop) }",
      'ten(prop)',
      "if (ok) { var held = 'aria-label' }",
      'eleven(held)',
    ].join('\n')

    // Past the switch, the block, the loop or the catch, the body of the function binds it.
    for (const marker of ['one(', 'two(', 'four(', 'five(', 'six(', 'seven(', 'nine(']) {
      expect(valueAt(scoped, 'prop', marker)).toBe('aria-label')
    }

    expect(valueAt(scoped, 'held', 'eleven(')).toBe('aria-label')

    // A static block keeps it; a default of a parameter is outside the body.
    for (const marker of ['three(', 'eight(', 'ten(']) {
      expect(valueAt(scoped, 'prop', marker, 'constantNamed')).toBe('data-testid')
    }
  })
  it('reads the names of a namespace in the scope around it: its body is no scope', () => {
    const spaced = [
      "const event = 'x.sessions.reset-button'",
      "namespace Sessions { namespace Row { export const event = 'x.sessions.revoke-button' } }",
      'namespace Sessions { namespace Row { one(event) } }',
      "namespace Devices.Row { const own = 'x.devices.revoke-button'; two(own) }",
      "namespace Devices { export const own = 'x.devices.reset-button' }",
      "namespace Sample { export const shared = 'aria-label' }",
      'namespace Sample { three(shared) }',
      'namespace Sample.Row { four(shared) }',
    ].join('\n')

    // Each name binds in the file, the first declaration of it being the one read.
    expect(valueAt(spaced, 'event', 'one(', 'constantNamed')).toBe('x.sessions.reset-button')
    expect(valueAt(spaced, 'own', 'two(', 'constantNamed')).toBe('x.devices.revoke-button')
    expect(valueAt(spaced, 'shared', 'three(', 'constantNamed')).toBe('aria-label')
    expect(valueAt(spaced, 'shared', 'four(', 'constantNamed')).toBe('aria-label')
  })
  it('reads the vars of one function and its parameter as each value they give it: one where they agree', () => {
    const twice = [
      "function a() { var prop: Label = 'aria-label'; switch (mode) { default: var prop: Label; one(prop) } }",
      "function b() { var prop = 'aria-label'; if (ok) { var prop = 'data-testid' } two(prop) }",
      "function c() { var prop = 'aria-label'; if (ok) { var prop = 'aria-label' } three(prop) }",
      "function d(prop) { if (ok) { var prop = 'aria-label' } four(prop) }",
      "function e() { for (var prop of labels) { five(prop) } var prop = 'aria-label' }",
    ].join('\n')

    // A bare `var` keeps the value; two that state it alike state it.
    expect(valueAt(twice, 'prop', 'one(')).toBe('aria-label')
    expect(valueAt(twice, 'prop', 'three(')).toBe('aria-label')

    // Two values, or one beside the argument or a loop's element, state none.
    for (const marker of ['two(', 'four(', 'five(']) {
      expect(valueAt(twice, 'prop', marker)).toBeUndefined()
    }
  })
})

describe('declaredTypeOf', () => {
  /** The source of the type the file writes for `expression`, read where `marker` is written. */
  function declaredAt(text: string, expression: string, marker: string): string | undefined {
    const full = `${text}\nconst probe = ${expression}`
    const { program } = parseSync('x.tsx', full, { lang: 'tsx', sourceType: 'module' })
    const declaration = program.body.at(-1)
    const value =
      declaration?.type === 'VariableDeclaration' ? declaration.declarations[0]?.init : undefined

    if (value === undefined || value === null) {
      throw new Error('the probe declares the expression')
    }

    const type = localsOf(program).declaredTypeOf(value, text.indexOf(marker))
    // A union, written or of the types several declarations write, as its types.
    const source = (written: TSType): string =>
      written.type === 'TSUnionType'
        ? written.types.map(source).join(' | ')
        : full.slice(written.start, written.end)

    return type === undefined ? undefined : source(type)
  }

  const text = [
    'export {}',
    'interface Props { readonly draft: Draft; readonly form: { readonly name: Name } }',
    'function a(props: { readonly draft: Draft; readonly form: { readonly name: Name } }) { const { draft } = props; const { form: { name } } = props; one() }',
    'function b({ draft, form: { name } }: Props) { two() }',
    'function c({ draft }: { readonly draft: Draft } = fallback) { three() }',
    'function d({ draft = fallback }: Props, { ...rest }: Props, [first]: Props[]) { four() }',
    'function e(props) { const { draft } = props; five() }',
    'function f() { const typed: Draft = load(); const { draft }: Props = load(); const holder: Props = load(); const { draft: kept } = holder; const { draft: defaulted = fallback } = holder; const built = load(); six() }',
    'function g(props: Props) { return (props) => seven() }',
    'for (const item of items) { eight() }',
  ].join('\n')

  it('reads the type a parameter is written with, and a member of it', () => {
    expect(declaredAt(text, 'props', 'one(')).toBe(
      '{ readonly draft: Draft; readonly form: { readonly name: Name } }',
    )
    expect(declaredAt(text, 'props.draft', 'one(')).toBe('Draft')
    expect(declaredAt(text, 'props.form.name', 'one(')).toBe('Name')
  })
  it('reads the type of a name destructured from a typed parameter, or in a typed parameter', () => {
    expect(declaredAt(text, 'draft', 'one(')).toBe('Draft')
    expect(declaredAt(text, 'name', 'one(')).toBe('Name')
    expect(declaredAt(text, 'draft', 'two(')).toBe('Draft')
    expect(declaredAt(text, 'name', 'two(')).toBe('Name')
    // A default of the whole parameter must be of its type.
    expect(declaredAt(text, 'draft', 'three(')).toBe('Draft')
  })
  it('reads the type a variable is written with, destructured, or destructured from one', () => {
    expect(declaredAt(text, 'typed', 'six(')).toBe('Draft')
    expect(declaredAt(text, 'draft', 'six(')).toBe('Draft')
    expect(declaredAt(text, 'kept', 'six(')).toBe('Draft')
  })
  it('reads none the file does not write: a default of the name, a rest, an array, an untyped parameter, a value', () => {
    expect(declaredAt(text, 'draft', 'four(')).toBeUndefined()
    expect(declaredAt(text, 'rest', 'four(')).toBeUndefined()
    expect(declaredAt(text, 'first', 'four(')).toBeUndefined()
    expect(declaredAt(text, 'props', 'five(')).toBeUndefined()
    expect(declaredAt(text, 'draft', 'five(')).toBeUndefined()
    expect(declaredAt(text, 'defaulted', 'six(')).toBeUndefined()
    expect(declaredAt(text, 'built', 'six(')).toBeUndefined()
    expect(declaredAt(text, 'item', 'eight(')).toBeUndefined()
    expect(declaredAt(text, 'elsewhere', 'eight(')).toBeUndefined()
  })
  it('reads none for anything but a name or a member: a computed member, a call, a cast, a chain', () => {
    expect(declaredAt(text, "props['draft']", 'one(')).toBeUndefined()
    expect(declaredAt(text, 'load()', 'six(')).toBeUndefined()
    expect(declaredAt(text, '(typed as Draft)', 'six(')).toBeUndefined()
    expect(declaredAt(text, 'props?.draft', 'one(')).toBeUndefined()
  })
  it('reads a name in the scope that binds it: an untyped parameter hides a typed one', () => {
    expect(declaredAt(text, 'props', 'seven(')).toBeUndefined()
  })
  it('reads a var declared again, or a parameter a var declares again, as of any type they write', () => {
    const again = [
      'export {}',
      'function h(draft: Draft) { if (ok) { var draft = load() } one() }',
      'function i(draft: Draft) { if (ok) { var draft: Other = load() } two() }',
      'function j(draft: Draft) { var draft; three() }',
      'function k() { var draft: Draft = load(); { var draft: Other = load() } four() }',
    ].join('\n')

    expect(declaredAt(again, 'draft', 'one(')).toBe('Draft')
    expect(declaredAt(again, 'draft', 'two(')).toBe('Draft | Other')
    expect(declaredAt(again, 'draft', 'three(')).toBe('Draft')
    expect(declaredAt(again, 'draft', 'four(')).toBe('Draft | Other')
  })
  it('reads a name a case of a switch declares only in the switch: past it, the parameter', () => {
    const cased = [
      'export {}',
      "function Row({ checkEvent }) { switch (mode) { case 'preview': const checkEvent: Draft = readDraft(); one(); break } two() }",
    ].join('\n')

    expect(declaredAt(cased, 'checkEvent', 'one(')).toBe('Draft')
    expect(declaredAt(cased, 'checkEvent', 'two(')).toBeUndefined()
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
    'async function asyncFalls() { await load() }',
    'async function asyncBare() { return }',
    'async function asyncNull(c) { if (c) { return null } return false }',
    'async function asyncMaybe(c) { if (c) { return null } return { mark: 1 } }',
    'function* generatedFalls() { yield 1 }',
    'const fallbackMap = { search: searchProps, ...asyncFalls() }',
    'const extraMap = { search: searchProps, ...props.extra }',
    'async function asyncSearch() { await load(); return { search: searchProps } }',
    "const overridden = { label: 'Search', ...asyncSearch() }",
    'const listed = [searchProps]',
    'for (const row of listed) { inRow() }',
    'for (let letRow of [searchProps] as const) { inLetRow() }',
    'for (const { search: pickedRow } of [inputProps]) { inPickedRow() }',
    'for (const spreadRow of [...more, searchProps]) { inSpreadRow() }',
    'for (const holeRow of [, searchProps]) { inHoleRow() }',
    'for (const callRow of [searchProps, rowOf()]) { inCallRow() }',
    'for (const tagged of [{ props: searchProps }, { props: props.extra }]) { inTagged() }',
    'const pushed = [searchProps]',
    'pushed.push(more)',
    'for (const pushedRow of pushed) { inPushedRow() }',
    'const read = [searchProps]',
    'const readCount = read.length + [...read].length',
    'for (const readRow of read) { inReadRow() }',
    'function overParam(list) { for (const paramRow of list) { inParamRow() } }',
    'for (const keyRow in searchProps) { inKeyRow() }',
    'for (var varRow of listed) { inVarRow() }',
    'const numbered = { search: searchProps, ...{ 0: base, [1]: base } }',
    'const deep0 = { search: searchProps }',
    ...Array.from({ length: 8 }, (_, at) => `const deep${at + 1} = { ...deep${at} }`),
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
  it('takes the right of ?? and || where the left is nothing: a nothing on the left adds no branch', () => {
    for (const argument of [
      'null ?? base',
      'undefined ?? base',
      '(ok ? null : base) || groups.name',
      '(ok ? null : base) ?? groups.name',
    ]) {
      const either = supplied(text, argument, 'const at')

      expect([...either.certain]).toEqual(['id'])
      expect(either.followed).toBe(true)
    }

    // An absent member selects the right too, while the unknown branch before it stays.
    const absent = supplied(text, 'overridden.search ?? searchProps', 'const at')

    expect(absent.followed).toBe(false)
    expect([...absent.followedCertain]).toEqual(['data-testid'])
  })
  it('keeps the nothing of && and an unknown left of ?? and ||', () => {
    const gated = supplied(text, 'ok && base', 'const at')

    expect(gated.props.map(({ name }) => name)).toEqual(['id'])
    expect(gated.certain.size).toBe(0)
    expect(gated.followed).toBe(true)

    for (const argument of ['props.extra ?? base', 'props.extra || base']) {
      const unknown = supplied(text, argument, 'const at')

      expect(unknown.followed).toBe(false)
      expect(unknown.certain.size).toBe(0)
      expect([...unknown.followedCertain]).toEqual(['id'])
    }
  })
  it('keeps a nothing that may be false before ??, which only a nullish one passes, and drops it before ||', () => {
    // `false ?? x` is `false`, which supplies nothing; `false || x` is `x`.
    for (const argument of ['(ok && base) ?? groups.name', 'false ?? base']) {
      const kept = supplied(text, argument, 'const at')

      expect(kept.certain.size, argument).toBe(0)
      expect(kept.followed, argument).toBe(true)
    }

    for (const argument of ['(ok && base) || groups.name', 'false || base']) {
      const right = supplied(text, argument, 'const at')

      expect([...right.certain], argument).toEqual(['id'])
      expect(right.followed, argument).toBe(true)
    }

    // A `0` or a `''` is a value the check does not follow: unknown, before ?? and || alike.
    for (const argument of [
      '0 ?? base',
      "'' ?? base",
      '0 || base',
      "'' || base",
      'ok ? 0 : base',
    ]) {
      const unknown = supplied(text, argument, 'const at')

      expect(unknown.followed, argument).toBe(false)
      expect([...unknown.followedCertain], argument).toEqual(['id'])
    }
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
  it('still says a nested branch it cannot follow cannot be followed, though the scan goes on past it', () => {
    expect(supplied(text, 'opaque.name', 'const at').followed).toBe(false)
  })
  it('goes on past a spread it cannot follow, with the property before it as one more alternative', () => {
    // The spread may supply the key or not: what the property before it supplies stays visible,
    // and nothing is certain.
    const members: Array<[string, string]> = [
      ['fallbackMap.search', 'data-testid'],
      ['extraMap.search', 'data-testid'],
      ['opaque.name', 'aria-invalid'],
    ]

    for (const [member, before] of members) {
      const read = supplied(text, member, 'const at')

      expect(read.followed).toBe(false)
      expect(read.props.map(({ name }) => name)).toEqual([before])
      expect(read.certain.size).toBe(0)
      expect([...read.followedCertain]).toEqual([before])
    }
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
  it('never takes an async function or a generator for nothing: a fall-through or a null adds no followed branch', () => {
    const gives = ['asyncFalls()', 'asyncBare()', 'asyncNull(1)', 'generatedFalls()']

    for (const call of gives) {
      const result = supplied(text, call, 'const at')

      expect(result.followed).toBe(false)
      expect(result.props).toEqual([])
      expect(result.followedCertain.size).toBe(0)
    }

    // Beside a branch that supplies, it leaves that branch the one followed, so what it supplies counts.
    for (const call of gives) {
      const either = supplied(text, `ok ? base : ${call}`, 'const at')

      expect(either.followed).toBe(false)
      expect([...either.followedCertain]).toEqual(['id'])
      expect(either.certain.size).toBe(0)
    }

    // The object it returns on another path stays visible, its null adds nothing.
    const maybe = supplied(text, 'asyncMaybe(1)', 'const at')

    expect(maybe.followed).toBe(false)
    expect(maybe.props.map(({ name }) => name)).toEqual(['mark'])
    expect([...maybe.followedCertain]).toEqual(['mark'])
    expect(maybe.certain.size).toBe(0)

    // A function that is not async still gives nothing where its end is reached.
    const plain = supplied(text, 'ok ? base : maybe(1)', 'const at')

    expect(plain.followed).toBe(true)
    expect(plain.followedCertain.size).toBe(0)
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
  it('follows the const of a for…of head to each element of the array the file states it iterates', () => {
    // An array only read besides, its `length` or a spread of it, still yields its elements.
    for (const [row, marker] of [
      ['row', 'inRow('],
      ['pickedRow', 'inPickedRow('],
      ['readRow', 'inReadRow('],
    ] as const) {
      const read = supplied(text, row, marker)

      expect(read.props.map(({ name }) => name)).toEqual(['data-testid'])
      expect([...read.certain]).toEqual(['data-testid'])
      expect(read.followed).toBe(true)
    }
  })
  it('keeps the variable of a for…of unknown where an element of its array cannot be said, or it may be reassigned', () => {
    // A spread element, a hole or a call it cannot follow makes the variable unknown as a whole,
    // and so does a member of it that one element leaves unknown: the element the array states
    // beside it is no alternative of its own, since the body may guard which element reaches it.
    // A parameter iterated, the key of a for…in, the var of a loop, which outlives it, the let of
    // its head, which the loop may reassign, and an array the file may change, say nothing either.
    for (const [row, marker] of [
      ['spreadRow', 'inSpreadRow('],
      ['holeRow', 'inHoleRow('],
      ['callRow', 'inCallRow('],
      ['tagged.props', 'inTagged('],
      ['pushedRow', 'inPushedRow('],
      ['letRow', 'inLetRow('],
      ['paramRow', 'inParamRow('],
      ['keyRow', 'inKeyRow('],
      ['varRow', 'inVarRow('],
    ] as const) {
      const read = supplied(text, row, marker)

      expect(read.followed).toBe(false)
      expect(read.props).toEqual([])
    }
  })
  it('says the value of each property whose key the file does not state, at any depth', () => {
    const read = supplied(
      text,
      "{ id: 1, [props.key]: 'x.search-input', ...{ [prop]: 3 }, [LABEL_PROP]: 2 }",
      'const at',
    )

    expect(read.unstated.map((value) => staticText(value) ?? value.type)).toEqual([
      'x.search-input',
      'Literal',
    ])
    expect(read.followed).toBe(false)
    expect(supplied(text, 'searchProps', 'const at').unstated).toEqual([])
  })
  it('reads a numeric key as its string, so a member of another name goes on past it', () => {
    const read = supplied(text, 'numbered.search', 'const at')

    expect(read.props.map(({ name }) => name)).toEqual(['data-testid'])
    expect(read.followed).toBe(true)
    expect(suppliedAt(text, '{ 0: 1, [1]: 2 }', 'const at')).toEqual(['0', '1'])
    expect(supplied(text, '{ 0: 1, [1]: 2 }', 'const at').unstated).toEqual([])
  })
  it('says a spread it stops following at its depth is abandoned there, and follows a shallower one', () => {
    const deep = supplied(text, 'deep8.search', 'const at')

    expect(deep.abandoned).toBe(true)
    expect(deep.followed).toBe(false)
    expect(deep.props).toEqual([])

    const shallow = supplied(text, 'deep3.search', 'const at')

    expect(shallow.abandoned).toBe(false)
    expect(shallow.props.map(({ name }) => name)).toEqual(['data-testid'])
    expect(supplied(text, 'props', 'const at').abandoned).toBe(false)
  })
  it('follows never a cycle, a parameter or a name the file does not declare', () => {
    expect(suppliedAt(text, 'loop()', 'const at')).toEqual([])
    expect(suppliedAt(text, 'props', 'const at')).toEqual([])
    expect(suppliedAt(text, 'elsewhere()', 'const at')).toEqual([])
  })
})
