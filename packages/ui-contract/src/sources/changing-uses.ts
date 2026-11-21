/**
 * Where a source file uses a name in a way that may change the array it holds, for `locals.ts` to
 * tell whether a `for…of` over that name yields the elements the file declares for it: every use
 * of the name but a plain read. A plain read is the right of a `for…of`, a spread of it
 * (`[...fields]`), a pattern it is destructured into, a `typeof` of it in a type, or a member read
 * (an index, `length`, a method) that is not assigned, updated or deleted and is no call of a
 * method that changes an array (`push`, `unshift`, `splice`, `sort`, `reverse`, `fill`,
 * `copyWithin`). So the array passed to a function (which may change it), handed on (to another
 * name, a property, an element, a JSX prop, a `return`) or assigned anew is one the file may
 * change, as far as the check can tell. A name that is no use of a value (its declaration, a
 * property's or a member's name, a key of a type) is none.
 */

import type { Expression, Program, Super } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

import { staticText, unwrap } from './values'

/** The methods of an array that change it. */
const CHANGING = new Set(['push', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin'])

/** A use of a name: the name, and where it is written. */
export interface NameUse {
  readonly name: string
  readonly start: number
}

export function changingUses(program: Program): NameUse[] {
  const uses: NameUse[] = []
  /** Where a name is a plain read, or no use of a value. */
  const plain = new Set<number>()
  /** Where a name is the array of a member that is changed: never a plain read. */
  const changed = new Set<number>()
  /** Where the name under `node` is written, where it is one. */
  const nameAt = (node: Expression | Super): number | undefined => {
    const written = node.type === 'Super' ? undefined : unwrap(node)

    return written?.type === 'Identifier' ? written.start : undefined
  }
  const mark = (into: Set<number>, node: Expression | Super): void => {
    const at = nameAt(node)

    if (at !== undefined) {
      into.add(at)
    }
  }
  /** The array of a member that is updated or deleted. */
  const changing = (node: Expression): void => {
    const target = unwrap(node)

    if (target.type === 'MemberExpression') {
      mark(changed, target.object)
    }
  }
  /** The name of a key the file writes as a name, which is no use of a value. */
  const keyed = (node: {
    readonly key: { readonly start: number }
    readonly computed: boolean
  }): void => {
    if (!node.computed) {
      plain.add(node.key.start)
    }
  }

  new Visitor({
    Identifier: (node) => {
      uses.push({ name: node.name, start: node.start })
    },
    VariableDeclarator: (node) => {
      plain.add(node.id.start)

      if (node.id.type !== 'Identifier' && node.init !== null) {
        mark(plain, node.init)
      }
    },
    MemberExpression: (node) => {
      mark(plain, node.object)

      if (!node.computed) {
        plain.add(node.property.start)
      }
    },
    CallExpression: ({ callee }) => {
      const method = callee.type === 'MemberExpression' ? callee : undefined
      const name =
        method === undefined
          ? undefined
          : method.computed
            ? staticText(method.property)
            : method.property.type === 'Identifier'
              ? method.property.name
              : undefined

      if (method !== undefined && name !== undefined && CHANGING.has(name)) {
        mark(changed, method.object)
      }
    },
    AssignmentExpression: ({ left }) => {
      if (left.type === 'MemberExpression') {
        mark(changed, left.object)
      }
    },
    UpdateExpression: ({ argument }) => {
      changing(argument)
    },
    UnaryExpression: ({ operator, argument }) => {
      if (operator === 'delete') {
        changing(argument)
      }
    },
    ForOfStatement: ({ right }) => {
      mark(plain, right)
    },
    SpreadElement: ({ argument }) => {
      mark(plain, argument)
    },
    TSTypeQuery: ({ exprName }) => {
      plain.add(exprName.start)
    },
    Property: (node) => {
      if (!node.shorthand) {
        keyed(node)
      }
    },
    MethodDefinition: keyed,
    PropertyDefinition: keyed,
    TSPropertySignature: keyed,
    TSMethodSignature: keyed,
  }).visit(program)

  return uses.filter(({ start }) => changed.has(start) || !plain.has(start))
}
