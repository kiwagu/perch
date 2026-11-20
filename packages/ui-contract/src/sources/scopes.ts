/**
 * The scopes of a source file, for `bindings.ts` to bind each name in the innermost one around its
 * declaration: a block, a function (its parameters), a loop whose head declares a `let`, a `const`
 * or a `using`, a `catch` clause with a parameter, and the file; a namespace's body is none, so its
 * names bind around it. Two more bind only a `let` or a `const` written in them: the block of a
 * `switch`'s cases (after its discriminant, which is read outside: a `const` of an unbraced `case`
 * binds in every case and nowhere past the switch) and a class `static` block; a function declared
 * there binds around them, as anywhere else. A `var` binds, as JavaScript binds it, in the body of
 * the function around it, a class `static` block or the file, whatever block, case, loop or `catch`
 * it is written in; a default of a parameter, outside the body, does not see it.
 */

import type {
  Expression,
  ForStatementInit,
  ForStatementLeft,
  FunctionBody,
  Program,
} from 'oxc-parser'
import { Visitor } from 'oxc-parser'

/** A range of the source, `[start, end)`. */
export interface Span {
  readonly start: number
  readonly end: number
}

export const FILE: Span = { start: 0, end: Number.POSITIVE_INFINITY }

export const contains = (outer: Span, inner: Span): boolean =>
  outer.start <= inner.start && inner.end <= outer.end

export const sizeOf = ({ start, end }: Span): number => end - start

/** The innermost of `scopes` around a place, not the place itself; the file around everything. */
export const scopeAround = (at: Span, scopes: readonly Span[]): Span =>
  scopes
    .filter((scope) => contains(scope, at) && (scope.start !== at.start || scope.end !== at.end))
    .reduce((inner, scope) => (sizeOf(scope) < sizeOf(inner) ? scope : inner), FILE)

/** The scopes of a file but the file itself, each in no particular order. */
export interface Scopes {
  /** Where every declaration but a `var` binds: a block, a function, a loop or a `catch` clause. */
  readonly every: readonly Span[]
  /** Where a `let` or a `const` binds too: the cases of a `switch`, a class `static` block. */
  readonly lexical: readonly Span[]
  /** Where a `var` binds: the body of a function, a class `static` block. */
  readonly hoisting: readonly Span[]
}

export function scopesIn(program: Program): Scopes {
  const every: Span[] = []
  const lexical: Span[] = []
  const hoisting: Span[] = []
  const fn = (node: Span & { readonly body: FunctionBody | Expression | null }): void => {
    every.push(node)

    // An arrow's expression body declares nothing.
    if (node.body?.type === 'BlockStatement') {
      hoisting.push(node.body)
    }
  }
  const loop = (node: Span, head: ForStatementInit | ForStatementLeft | null): void => {
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      every.push(node)
    }
  }

  new Visitor({
    BlockStatement: (node) => {
      every.push(node)
    },
    ArrowFunctionExpression: fn,
    FunctionExpression: fn,
    FunctionDeclaration: fn,
    ForStatement: (node) => {
      loop(node, node.init)
    },
    ForInStatement: (node) => {
      loop(node, node.left)
    },
    ForOfStatement: (node) => {
      loop(node, node.left)
    },
    CatchClause: (node) => {
      if (node.param !== null) {
        every.push(node)
      }
    },
    SwitchStatement: (node) => {
      lexical.push({ start: node.discriminant.end, end: node.end })
    },
    StaticBlock: (node) => {
      lexical.push(node)
      hoisting.push(node)
    },
  }).visit(program)

  return { every, lexical, hoisting }
}
