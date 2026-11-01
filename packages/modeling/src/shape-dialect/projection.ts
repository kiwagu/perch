/** The projection of a shape: its field paths, graph traversals, destructuring and aliases. */

import { ModelingException } from '../errors'
import { isKeyword, isPunct } from '../tokenizer'

import { ARROWS, type PathStep, type Projection } from './ast'
import type { Parser } from './parser'

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

export function parseList(
  parser: Parser,
  inDestructuring: boolean,
  atEnd: () => boolean,
): Projection[] {
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
