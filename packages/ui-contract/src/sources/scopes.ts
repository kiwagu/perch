/**
 * The lexical scopes of a source file, for `locals.ts` to bind each name in the innermost one
 * around its declaration: a block, a function (its parameters and body), a loop whose head
 * declares a `let`, a `const` or a `using` (a `var` binds around the loop), a `catch` clause with a
 * parameter, the block of a `switch`'s cases (after its discriminant, which is read outside: a
 * `const` in an unbraced `case` binds in every case and nowhere past the switch), a class `static`
 * block and a namespace's body.
 */

import type { ForStatementInit, ForStatementLeft, Program } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

/** A range of the source, `[start, end)`. */
export interface Span {
  readonly start: number
  readonly end: number
}

/** Every lexical scope of the file but the file itself, in no particular order. */
export function scopesIn(program: Program): Span[] {
  const scopes: Span[] = []
  const scope = (node: Span): void => {
    scopes.push(node)
  }
  const loop = (node: Span, head: ForStatementInit | ForStatementLeft | null): void => {
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      scopes.push(node)
    }
  }

  new Visitor({
    BlockStatement: scope,
    StaticBlock: scope,
    TSModuleBlock: scope,
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
        scopes.push(node)
      }
    },
    SwitchStatement: (node) => {
      scopes.push({ start: node.discriminant.end, end: node.end })
    },
  }).visit(program)

  return scopes
}
