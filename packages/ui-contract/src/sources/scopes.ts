/**
 * The scopes of a source file, for `bindings.ts` to bind each name in the innermost one around its
 * declaration, whatever its kind: a block, a function (its parameters), a loop whose head declares
 * a `let`, a `const` or a `using` (a `var` there binds around the loop), a `catch` clause with a
 * parameter, and the file; a namespace's body is none, so its names bind around it. Two more bind
 * only a `let` or a `const` written in them: the block of a `switch`'s cases (after its
 * discriminant, which is read outside: a `const` of an unbraced `case` binds in every case and
 * nowhere past the switch) and a class `static` block. A `var` or a function declared there binds
 * around them, as anywhere else.
 */

import type { ForStatementInit, ForStatementLeft, Program } from 'oxc-parser'
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
  /** Where every declaration binds: a block, a function, a loop or a `catch` clause. */
  readonly every: readonly Span[]
  /** Where a `let` or a `const` binds too: the cases of a `switch`, a class `static` block. */
  readonly lexical: readonly Span[]
}

export function scopesIn(program: Program): Scopes {
  const every: Span[] = []
  const lexical: Span[] = []
  const scope = (node: Span): void => {
    every.push(node)
  }
  const loop = (node: Span, head: ForStatementInit | ForStatementLeft | null): void => {
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      every.push(node)
    }
  }

  new Visitor({
    BlockStatement: scope,
    ArrowFunctionExpression: scope,
    FunctionExpression: scope,
    FunctionDeclaration: scope,
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
    },
  }).visit(program)

  return { every, lexical }
}
