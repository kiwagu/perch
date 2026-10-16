/**
 * Finds SurrealQL statements written as string or template literals in TypeScript.
 * Every read and write is declared in a `.surql` file next to its component, so a
 * literal that starts with a statement keyword is a query hiding from the modeling
 * stage. The scan walks the syntax tree, so comments and regular expressions are
 * never mistaken for strings.
 */

import { parseSync, Visitor } from 'oxc-parser'

export interface LiteralViolation {
  readonly path: string
  readonly line: number
  readonly rule: 'surrealql-literal'
  readonly text: string
}

const STATEMENT =
  /^\s*(SELECT|LIVE\s+SELECT|CREATE|UPDATE|UPSERT|DELETE|RELATE|DEFINE|REMOVE|INSERT|SHOW\s+CHANGES)\s+\S/

const lineOf = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length

export function findSurqlLiterals(path: string, source: string): LiteralViolation[] {
  const { program } = parseSync(path, source, {
    lang: path.endsWith('x') ? 'tsx' : 'ts',
    sourceType: 'module',
  })
  const violations: LiteralViolation[] = []
  const report = (text: string, start: number): void => {
    if (STATEMENT.test(text)) {
      violations.push({
        path,
        line: lineOf(source, start),
        rule: 'surrealql-literal',
        text: text.trim(),
      })
    }
  }

  new Visitor({
    Literal(node) {
      if (typeof node.value === 'string') {
        report(node.value, node.start)
      }
    },
    TemplateLiteral(node) {
      report(
        node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('…'),
        node.start,
      )
    },
  }).visit(program)

  return violations.sort((left, right) => left.line - right.line)
}
