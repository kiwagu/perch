/**
 * Finds SurrealQL statements written as string or template literals in TypeScript.
 * Every read and write is declared in a `.surql` file next to its component, so a
 * literal that starts with a statement keyword is a query hiding from the modeling
 * stage. The scan walks the syntax tree, so comments and regular expressions are
 * never mistaken for strings.
 */

import { parseSync } from 'oxc-parser'

export interface LiteralViolation {
  readonly path: string
  readonly line: number
  readonly rule: 'surrealql-literal'
  readonly text: string
}

const STATEMENT =
  /^\s*(SELECT|LIVE\s+SELECT|CREATE|UPDATE|UPSERT|DELETE|RELATE|DEFINE|REMOVE|INSERT|SHOW\s+CHANGES)\s+\S/

interface Node {
  readonly type?: string
  readonly start?: number
  readonly value?: unknown
  readonly quasis?: ReadonlyArray<{
    readonly value: { readonly cooked?: string | null; readonly raw: string }
  }>
}

function* nodes(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const item of value) {
      yield* nodes(item)
    }
  } else if (value !== null && typeof value === 'object') {
    const node = value as Node

    if (typeof node.type === 'string') {
      yield node
    }

    for (const child of Object.values(value)) {
      if (child !== null && typeof child === 'object') {
        yield* nodes(child)
      }
    }
  }
}

function literalText(node: Node): string | undefined {
  if (node.type === 'Literal' && typeof node.value === 'string') {
    return node.value
  }

  if (node.type === 'TemplateLiteral' && node.quasis) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('…')
  }

  return undefined
}

const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length

export function findSurqlLiterals(path: string, source: string): LiteralViolation[] {
  const { program } = parseSync(path, source, {
    lang: path.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const violations: LiteralViolation[] = []

  for (const node of nodes(program)) {
    const text = literalText(node)

    if (text !== undefined && STATEMENT.test(text)) {
      violations.push({
        path,
        line: lineOf(source, node.start ?? 0),
        rule: 'surrealql-literal',
        text: text.trim(),
      })
    }
  }

  return violations
}
