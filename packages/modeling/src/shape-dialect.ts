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

import { ModelingException } from './errors'
import { isKeyword, isPunct, type Token, tokenize } from './tokenizer'

export type PathStep =
  | { readonly kind: 'field'; readonly name: string }
  | {
      readonly kind: 'edge'
      readonly dir: 'out' | 'in' | 'both'
      readonly edge: string
      readonly target?: string
      readonly inner?: string
    }

export interface PathExpr {
  readonly steps: readonly PathStep[]
}

export interface Projection {
  readonly name: string
  readonly expr: PathExpr
  readonly children?: readonly Projection[]
}

export type ShapeSource =
  | { readonly kind: 'param'; readonly name: string; readonly only: boolean }
  | { readonly kind: 'table'; readonly table: string; readonly only: boolean }

/** A field path in the tail: from the shape's source, or from a record `$parameter`. */
export interface TailPath {
  readonly param?: string
  readonly steps: readonly PathStep[]
  /** A FETCH path also reads the record its last link points to. */
  readonly fetch?: boolean
}

export interface ShapeAst {
  readonly projections: readonly Projection[]
  readonly from: ShapeSource
  readonly tail: string
  readonly tailPaths: readonly TailPath[]
}

const ARROWS: Readonly<Record<string, 'out' | 'in' | 'both'>> = {
  '->': 'out',
  '<-': 'in',
  '<->': 'both',
}

const FORBIDDEN = ['GROUP', 'SPLIT', 'OMIT', 'EXPLAIN', 'TIMEOUT', 'PARALLEL', 'WITH']

/** Words of a tail that are clause keywords, operators or literals rather than fields. */
const TAIL_WORDS = new Set([
  'WHERE',
  'ORDER',
  'BY',
  'ASC',
  'DESC',
  'COLLATE',
  'NUMERIC',
  'RAND',
  'LIMIT',
  'START',
  'AT',
  'FETCH',
  'AND',
  'OR',
  'NOT',
  'IS',
  'IN',
  'CONTAINS',
  'CONTAINSNOT',
  'CONTAINSALL',
  'CONTAINSANY',
  'CONTAINSNONE',
  'INSIDE',
  'NOTINSIDE',
  'ALLINSIDE',
  'ANYINSIDE',
  'NONEINSIDE',
  'OUTSIDE',
  'INTERSECTS',
  'NONE',
  'NULL',
  'TRUE',
  'FALSE',
])

/** The field paths a tail reads; refuses forms whose reads cannot be determined. */
function parseTail(tokens: readonly Token[]): TailPath[] {
  const paths: TailPath[] = []
  let index = 0
  let fetching = false

  const followDots = (): PathStep[] => {
    const steps: PathStep[] = []

    while (isPunct(tokens[index], '.') && tokens[index + 1]?.kind === 'word') {
      steps.push({ kind: 'field', name: tokens[index + 1]?.text ?? '' })
      index += 2
    }

    return steps
  }

  while (index < tokens.length) {
    const token = tokens[index]

    if (!token) {
      break
    }

    // FETCH is the last clause: every word after it is a field, `in` included.
    if (isKeyword(token, 'FETCH')) {
      fetching = true
      index += 1
      continue
    }

    if (isKeyword(token, 'SELECT')) {
      throw new ModelingException(
        'subqueries are not allowed in a shape; read the other table in the projection or a DEFINE FUNCTION',
      )
    }

    if (token.kind === 'punct' && token.text in ARROWS) {
      throw new ModelingException(
        'graph traversals belong in the projection of a shape, not in its WHERE, ORDER BY or FETCH',
      )
    }

    if (token.kind === 'word' && isPunct(tokens[index + 1], '(')) {
      // Built-in functions (`string::lowercase`, `count`) read no table; a custom
      // function may read any.
      if (token.text.toLowerCase().startsWith('fn::')) {
        throw new ModelingException(
          `a custom function such as ${token.text} may read any table; keep it out of a shape's tail`,
        )
      }

      index += 1
      continue
    }

    if (token.kind === 'param') {
      index += 1

      const steps = followDots()

      if (steps.length > 0) {
        paths.push({ param: token.text, steps, ...(fetching ? { fetch: true } : {}) })
      }

      continue
    }

    // `in` and `out` are operators and also the fields of a relation: a word
    // followed by a dot is always a field path.
    const fieldLike =
      fetching || !TAIL_WORDS.has(token.text.toUpperCase()) || isPunct(tokens[index + 1], '.')

    if (token.kind === 'word' && fieldLike) {
      index += 1
      paths.push({
        steps: [{ kind: 'field', name: token.text }, ...followDots()],
        ...(fetching ? { fetch: true } : {}),
      })
      continue
    }

    index += 1
  }

  return paths
}

class Parser {
  #index = 0

  constructor(
    private readonly source: string,
    private readonly tokens: readonly Token[],
  ) {}

  get done(): boolean {
    return this.#index >= this.tokens.length
  }

  peek(offset = 0): Token | undefined {
    return this.tokens[this.#index + offset]
  }

  next(): Token {
    const token = this.tokens[this.#index]

    if (!token) {
      throw new ModelingException('the shape ends too early')
    }

    this.#index++

    return token
  }

  expectPunct(text: string): void {
    const token = this.next()

    if (!isPunct(token, text)) {
      throw new ModelingException(`expected "${text}" but found "${token.text}"`)
    }
  }

  word(what: string): string {
    const token = this.next()

    if (token.kind !== 'word') {
      throw new ModelingException(`expected ${what} but found "${token.text}"`)
    }

    return token.text
  }

  /** The raw text of a parenthesised group, the opening "(" being the next token. */
  group(): string {
    const open = this.next()
    let depth = 1

    while (depth > 0) {
      const token = this.next()

      depth += isPunct(token, '(') ? 1 : isPunct(token, ')') ? -1 : 0

      if (depth === 0) {
        return this.source.slice(open.end, token.start).trim()
      }
    }

    return ''
  }

  rest(): string {
    const first = this.peek()

    return first ? this.source.slice(first.start).trim() : ''
  }
}

function parseEdge(parser: Parser): PathStep {
  const arrow = parser.next().text
  const dir = ARROWS[arrow] ?? 'out'
  const edge = parser.word('an edge table')

  if (!isPunct(parser.peek(), arrow)) {
    return { kind: 'edge', dir, edge }
  }

  parser.next()

  if (isPunct(parser.peek(), '(')) {
    const inner = parser.group()
    const target = /\bFROM\s+(?:ONLY\s+)?([A-Za-z_]\w*)/i.exec(inner)?.[1]

    return { kind: 'edge', dir, edge, ...(target ? { target } : {}), inner }
  }

  return { kind: 'edge', dir, edge, target: parser.word('a target table') }
}

function parsePath(parser: Parser): PathStep[] {
  const steps: PathStep[] = []

  for (;;) {
    const token = parser.peek()

    if (token?.kind === 'punct' && token.text in ARROWS) {
      steps.push(parseEdge(parser))
    } else if (token?.kind === 'word' && (steps.length === 0 || isPunct(parser.peek(-1), '.'))) {
      if (isPunct(parser.peek(1), '(')) {
        throw new ModelingException(
          `function calls such as ${token.text}() belong in a DEFINE FUNCTION, not in a shape`,
        )
      }

      steps.push({ kind: 'field', name: parser.next().text })
    } else if (isPunct(token, '*')) {
      throw new ModelingException('list the fields a shape needs instead of *')
    } else {
      throw new ModelingException(`unexpected "${token?.text ?? 'end of shape'}" in a projection`)
    }

    if (isPunct(parser.peek(), '.') && parser.peek(1)?.kind === 'word') {
      parser.next()
    } else if (!(parser.peek()?.kind === 'punct' && (parser.peek()?.text ?? '') in ARROWS)) {
      return steps
    }
  }
}

function defaultName(steps: readonly PathStep[]): string {
  const last = steps.at(-1)

  if (last?.kind !== 'field') {
    throw new ModelingException('a graph traversal needs an alias: add "AS <name>"')
  }

  return last.name
}

function parseProjection(parser: Parser, inDestructuring: boolean): Projection {
  let alias: string | undefined

  if (inDestructuring && parser.peek()?.kind === 'word' && isPunct(parser.peek(1), ':')) {
    alias = parser.next().text
    parser.next()
  }

  const steps = parsePath(parser)
  let children: Projection[] | undefined

  if (isPunct(parser.peek(), '.') && isPunct(parser.peek(1), '{')) {
    parser.next()
    parser.next()
    children = parseList(parser, true, () => isPunct(parser.peek(), '}'))
    parser.expectPunct('}')
  }

  if (!inDestructuring && isKeyword(parser.peek(), 'AS')) {
    parser.next()
    alias = parser.word('an alias')
  }

  return { name: alias ?? defaultName(steps), expr: { steps }, ...(children ? { children } : {}) }
}

function parseList(parser: Parser, inDestructuring: boolean, atEnd: () => boolean): Projection[] {
  const projections = [parseProjection(parser, inDestructuring)]

  while (isPunct(parser.peek(), ',')) {
    parser.next()

    if (atEnd()) {
      break
    }

    projections.push(parseProjection(parser, inDestructuring))
  }

  return projections
}

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
