import { parseSync, type TSType, Visitor } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { declaredTypesIn } from './declared-type'

/** The type declarations of the file `lines` make, and the type it writes for its `probe`. */
function probed(lines: readonly string[]) {
  const text = lines.join('\n')
  const { program } = parseSync('x.tsx', text, { lang: 'tsx', sourceType: 'module' })
  const found: TSType[] = []

  new Visitor({
    VariableDeclarator: (node) => {
      const annotation = node.id.type === 'Identifier' ? node.id.typeAnnotation : undefined

      if (node.id.type === 'Identifier' && node.id.name === 'probe' && annotation) {
        found.push(annotation.typeAnnotation)
      }
    },
  }).visit(program)

  const [type] = found

  if (type === undefined) {
    throw new Error('the file types its probe')
  }

  return { types: declaredTypesIn(program), type, text }
}

/** Whether the file says its probe cannot carry a `type`. */
const carriesNoType = (...lines: string[]): boolean => {
  const { types, type } = probed(lines)

  return types.cannotCarry(type, 'type')
}

/** The source of the type the file declares for `key` of its probe, if it says. */
const memberText = (key: string, ...lines: string[]): string | undefined => {
  const { types, type, text } = probed(lines)
  const member = types.memberOf(type, key)

  return member === undefined ? undefined : text.slice(member.start, member.end)
}

const DRAFT = 'interface Draft { readonly key: string; readonly name: string }'

describe('declaredTypesIn', () => {
  describe('cannotCarry', () => {
    it('says a type the file declares without the key cannot carry it: an interface, a literal, an alias, in parentheses', () => {
      expect(carriesNoType('export {}', DRAFT, 'let probe: Draft')).toBe(true)
      expect(carriesNoType(`export ${DRAFT}`, 'let probe: Draft')).toBe(true)
      expect(
        carriesNoType('export {}', 'let probe: { readonly key: string; name(): string }'),
      ).toBe(true)
      expect(
        carriesNoType('export {}', 'type Draft = { readonly key: string }', 'let probe: (Draft)'),
      ).toBe(true)
    })
    it('follows an interface through each interface or alias it extends', () => {
      const bases = [
        'export {}',
        'interface Keyed { readonly key: string }',
        'type Named = { readonly name: string }',
      ]

      expect(
        carriesNoType(...bases, 'interface Draft extends Keyed, Named {}', 'let probe: Draft'),
      ).toBe(true)
      expect(
        carriesNoType(
          'export {}',
          'interface Typed { readonly type: string }',
          'interface Draft extends Typed { readonly key: string }',
          'let probe: Draft',
        ),
      ).toBe(false)
      expect(
        carriesNoType(
          "import type { Base } from './base'",
          'interface Draft extends Base { readonly key: string }',
          'let probe: Draft',
        ),
      ).toBe(false)
      expect(
        carriesNoType(
          'export {}',
          'interface Base<T> { readonly value: T }',
          'interface Draft extends Base<string> {}',
          'let probe: Draft',
        ),
      ).toBe(false)
    })
    it('says a union or an intersection of such types cannot carry it, undefined and null among them', () => {
      expect(carriesNoType('export {}', DRAFT, 'let probe: Draft | undefined')).toBe(true)
      expect(carriesNoType('export {}', DRAFT, 'let probe: null | Draft')).toBe(true)
      expect(carriesNoType('export {}', 'let probe: { a: string } & { b: string }')).toBe(true)
      expect(
        carriesNoType('export {}', DRAFT, 'let probe: Draft | { readonly type: string }'),
      ).toBe(false)
      expect(carriesNoType('export {}', DRAFT, 'let probe: Draft & { type?: string }')).toBe(false)
    })
    it('cannot tell a type with the key, an index, a call or a construct signature, or a key it cannot read', () => {
      for (const type of [
        '{ readonly type: string }',
        '{ type?: string }',
        '{ type(): string }',
        '{ get type(): string }',
        "{ 'type': string }",
        "{ ['type']: string }",
        '{ readonly [key: string]: string }',
        '{ (): void }',
        '{ new (): object }',
        '{ [KEY]: string }',
        '{ 0: string }',
      ]) {
        expect(carriesNoType('export {}', "const KEY = 'other'", `let probe: ${type}`)).toBe(false)
      }
    })
    it('cannot tell an import, a generic, a mapped or utility type, any, unknown or a type argument', () => {
      expect(carriesNoType("import type { Draft } from './draft'", 'let probe: Draft')).toBe(false)
      expect(
        carriesNoType(
          'export {}',
          'interface Draft<T> { readonly key: T }',
          'let probe: Draft<string>',
        ),
      ).toBe(false)
      expect(
        carriesNoType('export {}', 'type Draft<T> = { readonly key: T }', 'let probe: Draft'),
      ).toBe(false)

      for (const type of [
        'Partial<Draft>',
        'Readonly<Draft>',
        'Record<string, string>',
        "{ [K in 'key' | 'name']: string }",
        'any',
        'unknown',
        'object',
        'never',
        'Draft<string>',
        'Draft[]',
        'typeof draft',
        'Space.Draft',
        "import('./draft').Draft",
      ]) {
        expect(carriesNoType('export {}', DRAFT, `let probe: ${type}`)).toBe(false)
      }
    })
    it('cannot tell a type the file declares more than once, or not at its top', () => {
      for (const other of [
        'interface Draft { readonly type: string }',
        'type Twice = { readonly [Draft in "a"]: Draft }',
        'function f<Draft>() {}',
        'function g() { interface Draft { readonly type: string } }',
        'class Draft {}',
        'enum Draft { A }',
        'namespace Draft {}',
        "import { type Draft as Other, Draft } from './draft'",
      ]) {
        expect(carriesNoType('export {}', DRAFT, other, 'let probe: Draft')).toBe(false)
      }

      expect(carriesNoType('export {}', `function h() { ${DRAFT}; let probe: Draft }`)).toBe(false)
      // A type parameter hides the file's interface where it is in scope.
      expect(carriesNoType('export {}', DRAFT, 'function f<Draft>() { let probe: Draft }')).toBe(
        false,
      )
    })
    it('cannot tell a type of a file that is no module: its declarations may merge with global ones', () => {
      expect(carriesNoType('interface Event { readonly name: string }', 'let probe: Event')).toBe(
        false,
      )
      expect(
        carriesNoType('export {}', 'interface Event { readonly name: string }', 'let probe: Event'),
      ).toBe(true)
    })
    it('ends a cycle of aliases or interfaces unknown, never in a stack overflow', () => {
      expect(carriesNoType('export {}', 'type A = B', 'type B = A', 'let probe: A')).toBe(false)
      expect(
        carriesNoType(
          'export {}',
          'interface A extends B {}',
          'interface B extends A {}',
          'let probe: A',
        ),
      ).toBe(false)
    })
  })

  describe('memberOf', () => {
    it('reads the type of a key in a literal, an interface, an interface it extends, or an alias', () => {
      expect(memberText('draft', 'export {}', 'let probe: { readonly draft: Draft }')).toBe('Draft')
      expect(
        memberText(
          'draft',
          'export {}',
          'interface Props { readonly draft?: Draft; readonly can: () => boolean }',
          'let probe: Props',
        ),
      ).toBe('Draft')
      expect(
        memberText(
          'draft',
          'export {}',
          'interface Base { readonly draft: Draft }',
          'interface Props extends Base { readonly other: string }',
          'let probe: Props',
        ),
      ).toBe('Draft')
      expect(
        memberText(
          'draft',
          'export {}',
          'type Props = { readonly draft: Draft }',
          'let probe: (Props)',
        ),
      ).toBe('Draft')
    })
    it('reads none where it cannot tell: a method, a key declared twice or not at all, an index, a union, an import', () => {
      for (const lines of [
        ['let probe: { draft(): Draft }'],
        ['let probe: { draft }'],
        ['let probe: { draft: Draft; draft: Other }'],
        [
          'interface Base { readonly draft: Draft | Other }',
          'interface Props extends Base { readonly draft: Draft }',
          'let probe: Props',
        ],
        ['let probe: { readonly other: Draft }'],
        ['let probe: { readonly [key: string]: Draft; readonly draft: Draft }'],
        ['let probe: { [KEY]: Other; readonly draft: Draft }'],
        ['let probe: { readonly draft: Draft } | undefined'],
        ['let probe: { readonly draft: Draft } & { readonly other: Other }'],
        ["import type { Props } from './props'", 'let probe: Props'],
      ]) {
        expect(memberText('draft', 'export {}', ...lines)).toBeUndefined()
      }
    })
  })
})
