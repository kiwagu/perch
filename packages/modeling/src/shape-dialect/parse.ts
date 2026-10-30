/**
 * Parser of the shape dialect: one SELECT whose projection lists fields,
 * destructuring `a.{ ... }`, aliases (`expr AS name`, `name: expr`), graph
 * traversals (`->edge->table`, `<-edge<-table`, `<->`) and inner queries on an
 * edge, from a parameter or a table, with an optional tail (WHERE, ORDER BY,
 * LIMIT, START, FETCH) kept as text. The field paths of the tail are collected
 * too, so the tables a predicate reads through record links count as reads; a
 * tail whose reads cannot be determined (a subquery, a graph traversal, a custom
 * function) is refused. Anything else is refused, so the result type and the
 * reads of every shape can be derived from the schema.
 */
import { ModelingException } from '../errors'
import { isKeyword, isPunct, type Token, tokenize } from '../tokenizer'

import type { ShapeAst, ShapeSource } from './ast'
import { Parser } from './parser'
import { parseList } from './projection'
import { parseTail } from './tail'

const FORBIDDEN = ['GROUP', 'SPLIT', 'OMIT', 'EXPLAIN', 'TIMEOUT', 'PARALLEL', 'WITH']

function parseSource(parser: Parser): ShapeSource {
  const only = isKeyword(parser.peek(), 'ONLY')

  if (only) {
    parser.next()
  }

  const token = parser.next()

  if (token.kind === 'param') {
    return { kind: 'param', name: token.text, only }
  }

  if (token.kind === 'word') {
    return { kind: 'table', table: token.text, only }
  }

  throw new ModelingException(`a shape reads FROM a $parameter or a table, not "${token.text}"`)
}

/** Top-level tokens after FROM and its source: where clauses such as GROUP would appear. */
function clauseTokens(tokens: readonly Token[]): Token[] {
  let depth = 0
  let from = -1

  for (const [index, token] of tokens.entries()) {
    depth +=
      isPunct(token, '(') || isPunct(token, '{')
        ? 1
        : isPunct(token, ')') || isPunct(token, '}')
          ? -1
          : 0

    if (depth === 0 && isKeyword(token, 'FROM')) {
      from = index
    }
  }

  if (from === -1) {
    return []
  }

  const clauses: Token[] = []

  depth = 0

  for (const token of tokens.slice(from + 2)) {
    depth += isPunct(token, '(') ? 1 : isPunct(token, ')') ? -1 : 0

    if (depth === 0) {
      clauses.push(token)
    }
  }

  return clauses
}

export function parseShape(body: string): ShapeAst {
  const tokens = tokenize(body).filter(
    (token, index, all) => !(isPunct(token, ';') && index === all.length - 1),
  )

  if (!isKeyword(tokens[0], 'SELECT')) {
    throw new ModelingException('a shape must be a SELECT statement')
  }

  const forbidden = clauseTokens(tokens).find((token) =>
    FORBIDDEN.some((keyword) => isKeyword(token, keyword)),
  )

  if (forbidden) {
    throw new ModelingException(
      `${forbidden.text.toUpperCase()} is not allowed in a shape; aggregate in a DEFINE FUNCTION instead`,
    )
  }

  const parser = new Parser(body, tokens)

  parser.next()

  const projections = parseList(parser, false, () => isKeyword(parser.peek(), 'FROM'))

  if (!isKeyword(parser.peek(), 'FROM')) {
    throw new ModelingException(
      `expected FROM but found "${parser.peek()?.text ?? 'end of shape'}"`,
    )
  }

  parser.next()

  const from = parseSource(parser)
  const tail = parser.done ? '' : parser.rest().replace(/;\s*$/, '')

  return { projections, from, tail, tailPaths: parseTail(tokenize(tail)) }
}
