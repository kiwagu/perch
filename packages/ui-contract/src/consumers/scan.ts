/**
 * Reads what the e2e tests name of the contract, as the consumers check reads it: the anchor of
 * a `getByTestId('<anchor>')` call; in any string or template literal the attribute selectors
 * `[data-testid="..."]`, `[data-code="..."]`, `[data-state="..."]` and `[data-value="..."]`, in
 * double or single quotes; and the value a
 * `toHaveAttribute('data-<testid|code|state|value>', '<value>')` assertion expects, `.not`
 * included. An argument is a plain string or a template literal without `${}`, or a `+` chain
 * of them read as the one string it folds to, a TypeScript wrapper around it (`as const`,
 * parentheses) changing nothing; a `+` chain is read whole, as a template is, and a selector
 * is located by the lines of the source, whatever escapes its literal holds. Nothing else is
 * read: a `data-id` is data, and no helper is followed (a `notice(page, '<code>')` is not
 * read). An anchor built at runtime (a `getByTestId` of anything but such a string, a
 * `data-testid` selector whose value or closing quote an expression supplies) is a problem,
 * since no check can follow it; a code, a state or a value from an expression is a parameter
 * of the test and passes.
 */

import { readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { type Argument, type Expression, parseSync, Visitor } from 'oxc-parser'

import { filesUnder, type Problem } from '../files'
import type { Reference } from '../scenarios'

import { chainOf, EXPRESSION, foldedText, operandPieces, type Piece } from './pieces'
import { sourceOffset } from './source-offset'

/** Where the e2e tests are, from the repository root. */
export const CONSUMER_ROOT = 'tests/e2e/src'

export const RUNTIME_TEST_ANCHOR = `an anchor built at runtime; write it as a literal, getByTestId('<anchor>') or [data-testid="<anchor>"]`

export interface ConsumedLiteral {
  readonly kind: Exclude<Reference['kind'], 'route'>
  readonly value: string
  readonly line: number
}

export interface Consumed {
  readonly file: string
  readonly literals: ConsumedLiteral[]
  readonly problems: Problem[]
}

/** An attribute selector the check reads; `\0` (`EXPRESSION`) in its value is an expression. */
const SELECTOR = /\[data-(testid|code|state|value)=(["'])(.*?)\2\]/g

/** A `data-testid` selector that an expression completes: its value, or its closing quote. */
const OPEN_TEST_ID = /\[data-testid=["']?[^\]"'\0]*\0/g

const DATA = 'data-'

const TEST_SOURCE = /\.ts$/

const kindOf = (attribute: string): ConsumedLiteral['kind'] | undefined =>
  attribute === 'testid'
    ? 'anchor'
    : attribute === 'code' || attribute === 'state' || attribute === 'value'
      ? attribute
      : undefined

/**
 * What one file names of the contract. Every file is parsed: its raw text cannot show a name
 * that a `+` chain or an escape spells, only the folded text of each string can.
 */
export function collectFromTest(text: string, file: string): Consumed {
  const consumed: Consumed = { file, literals: [], problems: [] }
  const line = (offset: number): number => text.slice(0, offset).split('\n').length
  const { program, errors } = parseSync(file, text, { lang: 'ts', sourceType: 'module' })
  const [error] = errors

  if (error !== undefined) {
    const at = line(error.labels[0]?.start ?? 0)

    consumed.problems.push({ file, line: at, message: `cannot parse the file: ${error.message}` })

    return consumed
  }

  /** The source line of the character at `index` of the joined text of `pieces`. */
  const lineIn = (pieces: readonly Piece[], index: number): number => {
    let from = 0

    for (const piece of pieces) {
      if (index < from + piece.text.length) {
        return line(piece.expression ? piece.start : sourceOffset(text, piece.start, index - from))
      }

      from += piece.text.length
    }

    return line(pieces[0]?.start ?? 0)
  }

  /** A literal of `kind` at line `at`, or, built at runtime, a problem when it is an anchor. */
  const found = (kind: ConsumedLiteral['kind'], value: string | undefined, at: number): void => {
    if (value !== undefined) {
      consumed.literals.push({ kind, value, line: at })
    } else if (kind === 'anchor') {
      consumed.problems.push({ file, line: at, message: RUNTIME_TEST_ANCHOR })
    }
  }

  /** The selectors of a string expression, each at the line its `[` is on. */
  const selectors = (pieces: readonly Piece[]): void => {
    const joined = pieces.map((piece) => piece.text).join('')
    const complete = new Set<number>()

    for (const match of joined.matchAll(SELECTOR)) {
      const [, attribute = '', , value = ''] = match
      const kind = kindOf(attribute)

      complete.add(match.index)

      if (kind !== undefined) {
        found(kind, value.includes(EXPRESSION) ? undefined : value, lineIn(pieces, match.index))
      }
    }

    for (const match of joined.matchAll(OPEN_TEST_ID)) {
      if (!complete.has(match.index)) {
        found('anchor', undefined, lineIn(pieces, match.index))
      }
    }
  }

  /** The strings, templates and links of `+` chains already read as part of a whole chain. */
  const covered = new Set<Expression>()

  /** A string expression read whole: a `+` chain at its outermost link, or a lone literal. */
  const strings = (node: Expression): void => {
    if (covered.has(node)) {
      return
    }

    const { operands, links } = chainOf(node)

    for (const part of [...operands, ...links]) {
      covered.add(part)
    }

    selectors(operands.flatMap(operandPieces))
  }

  /** `toHaveAttribute('data-<attribute>', <value>)`: the value, at its line. */
  const asserted = ([name, value]: readonly Argument[]): void => {
    const attribute = foldedText(name)
    const kind = attribute?.startsWith(DATA) ? kindOf(attribute.slice(DATA.length)) : undefined

    if (kind !== undefined && value !== undefined) {
      found(kind, foldedText(value), line(value.start))
    }
  }

  new Visitor({
    CallExpression(node) {
      const { callee } = node
      const name =
        callee.type === 'Identifier'
          ? callee.name
          : callee.type === 'MemberExpression' && !callee.computed
            ? callee.property.name
            : undefined

      if (name === 'getByTestId') {
        const [argument] = node.arguments

        found('anchor', foldedText(argument), line(argument?.start ?? node.start))
      } else if (name === 'toHaveAttribute') {
        asserted(node.arguments)
      }
    },
    BinaryExpression(node) {
      if (node.operator === '+') {
        strings(node)
      }
    },
    Literal(node) {
      if (typeof node.value === 'string') {
        strings(node)
      }
    },
    TemplateLiteral(node) {
      strings(node)
    },
  }).visit(program)

  consumed.literals.sort((a, b) => a.line - b.line)
  consumed.problems.sort((a, b) => (a.line ?? 1) - (b.line ?? 1))

  return consumed
}

/**
 * The `.ts` files under `tests` (relative to `root` unless absolute; `tests/e2e/src` by
 * default), each collected and named by its path from the root; a folder it cannot read
 * is an error.
 */
export function scanConsumers(root: string, tests: string = CONSUMER_ROOT): Consumed[] {
  const folder = resolve(root, tests)
  const paths = filesUnder(folder)

  if (paths === undefined) {
    throw new Error(`cannot read the tests in ${tests}`)
  }

  return paths
    .filter((path) => TEST_SOURCE.test(path))
    .map((path) =>
      collectFromTest(
        readFileSync(join(folder, path), 'utf8'),
        relative(root, join(folder, path)).split(sep).join('/'),
      ),
    )
}
