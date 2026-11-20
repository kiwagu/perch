/**
 * The scopes of a source file, for `locals.ts` to bind each name in the innermost one around its
 * declaration. A `let`, a `const`, a function declaration, a parameter or a `catch` parameter binds
 * in its lexical scope: a block, a function (its parameters and body), a loop whose head declares
 * a `let`, a `const` or a `using` (a `var` binds around the loop), a `catch` clause with a
 * parameter, the block of a `switch`'s cases (after its discriminant, which is read outside: a
 * `const` in an unbraced `case` binds in every case and nowhere past the switch) and a class
 * `static` block. A `var` binds in the innermost function or class `static` block around it,
 * whatever block, case, loop or `catch` it is written in. A namespace's body is no scope here: its
 * names are read in the file, as one declaration of a namespace sees what another exports.
 */

import type { ForStatementInit, ForStatementLeft, Program } from 'oxc-parser'
import { Visitor } from 'oxc-parser'

/** A range of the source, `[start, end)`. */
export interface Span {
  readonly start: number
  readonly end: number
}

/** The scopes of a file but the file itself, each in no particular order. */
export interface Scopes {
  /** Where a `let`, a `const`, a function declaration or a parameter binds. */
  readonly lexical: readonly Span[]
  /** Where a `var` binds: a function or a class `static` block. */
  readonly hoisting: readonly Span[]
}

export function scopesIn(program: Program): Scopes {
  const lexical: Span[] = []
  const hoisting: Span[] = []
  const block = (node: Span): void => {
    lexical.push(node)
  }
  const fn = (node: Span): void => {
    lexical.push(node)
    hoisting.push(node)
  }
  const loop = (node: Span, head: ForStatementInit | ForStatementLeft | null): void => {
    if (head?.type === 'VariableDeclaration' && head.kind !== 'var') {
      lexical.push(node)
    }
  }

  new Visitor({
    BlockStatement: block,
    StaticBlock: fn,
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
        lexical.push(node)
      }
    },
    SwitchStatement: (node) => {
      lexical.push({ start: node.discriminant.end, end: node.end })
    },
  }).visit(program)

  return { lexical, hoisting }
}
