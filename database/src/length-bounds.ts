/**
 * The length bounds of a schema held to the contract's values. A limit is stated once, in the
 * contract, and reaches the schema as a database parameter named for the value
 * (`$<value>_max_length`, generated from the contract's values), which an assert names instead of
 * writing the number. So an upper length bound written as a number is a second statement of a
 * limit, except on a column the schema lists as holding no contract value, and every parameter an
 * assert names must be defined and hold the limit of the contract value it is named for.
 */

import { type TableModel, valueParamName } from '@workspace/modeling'
import type { ResolvedValue } from '@workspace/ui-contract'

import { readAssert } from './assert-limits'

export interface LengthBoundsInput {
  /** The tables of the schema by name. */
  readonly tables: ReadonlyMap<string, Pick<TableModel, 'asserts'>>
  /** The parameters the schema defines by name, each with the text the database holds. */
  readonly params: Readonly<Record<string, string>>
  /** The contract's values by name, as the kernel emits them. */
  readonly values: Readonly<Record<string, ResolvedValue>>
  /** The columns (`<table>.<column>`) that hold no contract value: their literal bound is theirs. */
  readonly literal: readonly string[]
}

/** The values with a length limit by the parameter that holds it. */
function valuesByParam(values: LengthBoundsInput['values']): ReadonlyMap<string, string[]> {
  const byParam = new Map<string, string[]>()

  for (const [name, { maxLength }] of Object.entries(values)) {
    if (maxLength !== undefined) {
      const param = valueParamName(name)

      byParam.set(param, [...(byParam.get(param) ?? []), name])
    }
  }

  return byParam
}

/** What is wrong with the length bounds of the schema, one line each; none when it holds. */
export function lengthBoundProblems({
  tables,
  params,
  values,
  literal,
}: LengthBoundsInput): string[] {
  const backing = valuesByParam(values)
  const problems: string[] = []
  const literalColumns = new Set<string>()
  const named = new Set<string>()

  for (const [table, { asserts }] of tables) {
    for (const [column, assert] of Object.entries(asserts)) {
      const where = `${table}.${column}`
      const { params: used, literalMaxima } = readAssert(assert, params)

      if (literalMaxima.length > 0) {
        literalColumns.add(where)

        if (!literal.includes(where)) {
          problems.push(
            `${where} writes the length bound ${literalMaxima.join(', ')}: name the parameter of its contract value`,
          )
        }
      }

      for (const param of used) {
        const held = Object.hasOwn(params, param) ? params[param] : undefined
        const backed = backing.get(param)

        if (held === undefined) {
          problems.push(`${where} names $${param}, which the schema does not define`)
        } else if (backed === undefined) {
          problems.push(`${where} names $${param}, which backs no contract value with a limit`)
        } else if (!named.has(param)) {
          for (const value of backed.filter((name) => values[name]?.maxLength !== Number(held))) {
            problems.push(
              `$${param} holds ${held}, the contract value ${value} has ${values[value]?.maxLength}`,
            )
          }
        }

        named.add(param)
      }
    }
  }

  for (const column of literal.filter((listed) => !literalColumns.has(listed))) {
    problems.push(`${column} is listed as a literal bound but writes none`)
  }

  return problems
}
