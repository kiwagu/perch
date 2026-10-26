/**
 * The pieces of a string expression as the consumers check reads it: a string literal, a
 * template literal, or a `+` chain of them and other operands, through parentheses and
 * TypeScript wrappers. A piece is static text, with the source offset its raw text starts
 * at, or an expression, which stands as `EXPRESSION` in the text the pieces join to.
 */

import type { Argument, Expression, TemplateLiteral } from 'oxc-parser'

import { unwrap } from '../sources'

/** An expression in the joined text of the pieces. */
export const EXPRESSION = '\0'

export interface Piece {
  /** The cooked text, or `EXPRESSION`. */
  readonly text: string
  /** Where its raw text starts (after the opening quote, backtick or `}`), or the expression. */
  readonly start: number
  readonly expression: boolean
}

/**
 * The operands of a `+` chain, left to right and unwrapped, and the links of the chain (its
 * `+` expressions); a single operand and no link for any other expression.
 */
export function chainOf(node: Expression): { operands: Expression[]; links: Expression[] } {
  const value = unwrap(node)

  if (value.type !== 'BinaryExpression' || value.operator !== '+') {
    return { operands: [value], links: [] }
  }

  const left = chainOf(value.left)
  const right = chainOf(value.right)

  return {
    operands: [...left.operands, ...right.operands],
    links: [value, ...left.links, ...right.links],
  }
}

/** The pieces of a template: its parts (oxc's span of each opens on its backtick or `}`). */
const templatePieces = (node: TemplateLiteral): Piece[] =>
  node.quasis.flatMap((quasi, index) => {
    const expression = node.expressions[index]
    const part = { text: quasi.value.cooked ?? quasi.value.raw, start: quasi.start + 1 }

    return [
      { ...part, expression: false },
      ...(expression === undefined
        ? []
        : [{ text: EXPRESSION, start: expression.start, expression: true }]),
    ]
  })

/** The pieces of one operand: a string, a template, or an expression. */
export function operandPieces(node: Expression): Piece[] {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return [{ text: node.value, start: node.start + 1, expression: false }]
  }

  return node.type === 'TemplateLiteral'
    ? templatePieces(node)
    : [{ text: EXPRESSION, start: node.start, expression: true }]
}

/**
 * The text of an argument with no expression in it (a string, a template without `${}`, a
 * `+` chain of them, a TypeScript wrapper around any of these), or undefined.
 */
export function foldedText(node: Argument | undefined): string | undefined {
  if (node === undefined || node.type === 'SpreadElement') {
    return undefined
  }

  const pieces = chainOf(node).operands.flatMap(operandPieces)

  return pieces.some(({ expression }) => expression)
    ? undefined
    : pieces.map(({ text }) => text).join('')
}
