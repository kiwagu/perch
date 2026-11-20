/**
 * An `ASSERT` as the database prints it, read for what it limits a value to: `IN` comes back as
 * `INSIDE`, a field that may be `NONE` has the guard `$value = NONE OR ...`, and the clauses of
 * an `AND` are joined on one line. A length bound written as `$name` is read for the number the
 * schema's parameter of that name holds, the way the database reads it when it writes a record.
 */

import { tokenize } from '@workspace/modeling'

/** What an `ASSERT` limits a value to. */
export interface Limits {
  min?: number
  max?: number
  email: boolean
  pattern?: string
  members?: string[]
  /** Clauses of the assert this reader does not know: the contract states nothing for them. */
  unread: string[]
}

export interface AssertReading {
  readonly limits: Limits
  /** The parameters the assert names as a length bound, defined or not, in the order written. */
  readonly params: string[]
  /** The upper length bounds (`<=`, `<`, `=`) the assert writes as a number: each is a second statement of a limit. */
  readonly literalMaxima: number[]
}

const LENGTH = /^string::len\(\$value\) (>=|>|<=|<|=) (\d+|\$\w+)$/
const MATCHES = /^string::matches\(\$value, ('.*'|".*")\)$/
const INSIDE = /^\$value INSIDE \[(.*)\]$/

/** A SurrealQL string literal's text: the quotes off, `\\` and an escaped quote resolved. */
const unquote = (literal: string): string => literal.slice(1, -1).replace(/\\([\\'"])/g, '$1')

/** Splits `text` at each `keyword` outside quotes and brackets. */
function splitAt(text: string, keyword: 'AND' | 'OR'): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0

  for (const token of tokenize(text)) {
    if (token.kind === 'punct' && '([{'.includes(token.text)) {
      depth++
    } else if (token.kind === 'punct' && ')]}'.includes(token.text)) {
      depth--
    } else if (depth === 0 && token.kind === 'word' && token.text.toUpperCase() === keyword) {
      parts.push(text.slice(from, token.start).trim())
      from = token.end
    }
  }

  return [...parts, text.slice(from).trim()]
}

/** The number a length bound's operand stands for: itself, or the whole number its parameter holds. */
function boundOf(operand: string, params: Readonly<Record<string, string>>): number | undefined {
  if (!operand.startsWith('$')) {
    return Number(operand)
  }

  const held = Object.hasOwn(params, operand.slice(1)) ? params[operand.slice(1)] : undefined

  return held !== undefined && /^\d+$/.test(held) ? Number(held) : undefined
}

/**
 * Reads `assert` (undefined: the column has none). `params` are the schema's parameters by name,
 * each with the text the database holds for it.
 */
export function readAssert(
  assert: string | undefined,
  params: Readonly<Record<string, string>>,
): AssertReading {
  const limits: Limits = { email: false, unread: [] }
  const reading: AssertReading = { limits, params: [], literalMaxima: [] }

  if (assert === undefined) {
    return reading
  }

  const [rule, ...others] = splitAt(assert, 'OR').filter((part) => part !== '$value = NONE')

  if (rule === undefined || others.length > 0) {
    limits.unread.push(assert)

    return reading
  }

  for (const clause of splitAt(rule, 'AND')) {
    const length = LENGTH.exec(clause)
    const pattern = MATCHES.exec(clause)?.[1]
    const members = INSIDE.exec(clause)?.[1]

    if (length) {
      const [, operator, operand = ''] = length
      const bound = boundOf(operand, params)

      if (operand.startsWith('$')) {
        reading.params.push(operand.slice(1))
      }

      if (bound === undefined) {
        limits.unread.push(clause)
      } else {
        if (operator === '>' || operator === '>=' || operator === '=') {
          limits.min = Math.max(limits.min ?? 0, operator === '>' ? bound + 1 : bound)
        }

        if (operator === '<' || operator === '<=' || operator === '=') {
          limits.max = Math.min(limits.max ?? bound, operator === '<' ? bound - 1 : bound)

          if (!operand.startsWith('$')) {
            reading.literalMaxima.push(bound)
          }
        }
      }
    } else if (clause === 'string::is_email($value)') {
      limits.email = true
    } else if (pattern !== undefined) {
      limits.pattern = unquote(pattern)
    } else if (members !== undefined) {
      limits.members = tokenize(members)
        .filter((token) => token.kind === 'string')
        .map((token) => unquote(token.text))
        .sort()
    } else {
      limits.unread.push(clause)
    }
  }

  return reading
}
