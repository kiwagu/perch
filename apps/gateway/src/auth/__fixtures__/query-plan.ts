/**
 * The plan SurrealDB reads a statement's rows by, as `EXPLAIN FULL` shows it: whether a read goes
 * through an index (and which range of it) or through the whole table, and how many rows it gave.
 */

import { expect } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { z } from '@workspace/zod'

/**
 * One operator of an explained plan, with the operators it reads from: of its attributes, the
 * index a read goes through and the range of it, of its metrics the rows it gave.
 */
interface PlanOperator {
  readonly operator: string
  readonly attributes?:
    | { readonly index?: string | undefined; readonly access?: string | undefined }
    | undefined
  readonly metrics: { readonly output_rows: number }
  readonly children?: readonly PlanOperator[] | undefined
}

const planOperator: z.ZodType<PlanOperator> = z.lazy(() =>
  z.object({
    operator: z.string(),
    attributes: z
      .looseObject({ index: z.string().optional(), access: z.string().optional() })
      .optional(),
    metrics: z.looseObject({ output_rows: z.number() }),
    children: z.array(planOperator).optional(),
  }),
)

/** A read of a table in a plan: its operator, the index and range it reads, the rows it gave. */
export interface PlanRead {
  /** `IndexScan` through an index, `TableScan` through every row of the table. */
  readonly operator: string
  readonly index: string | undefined
  /** The range of the index it reads, as SurrealDB prints it. */
  readonly access: string | undefined
  readonly rows: number
}

/** The selection a statement makes in parentheses, ending with its `LIMIT $limit`. */
const SELECTION = /\((\s*SELECT\b[\s\S]*?\bLIMIT \$limit)\s*\)/

/** Every read of a table under `operator`, depth first. */
function readsUnder(operator: PlanOperator): PlanRead[] {
  const own: PlanRead[] = operator.operator.endsWith('Scan')
    ? [
        {
          operator: operator.operator,
          index: operator.attributes?.index,
          access: operator.attributes?.access,
          rows: operator.metrics.output_rows,
        },
      ]
    : []

  return [...own, ...(operator.children ?? []).flatMap(readsUnder)]
}

/**
 * The reads of the selection `statement` makes (`(SELECT … LIMIT $limit)`), explained in full on
 * `local` with `params`: the statement's own text is explained, so a change of its selection is
 * what the plan shows.
 */
export async function selectionReads(
  local: LocalDb,
  statement: string,
  params: Readonly<Record<string, unknown>>,
): Promise<PlanRead[]> {
  const selection =
    SELECTION.exec(statement)?.[1] ?? expect.unreachable('a selection ending with LIMIT $limit')
  const [plan] = await local.db.query<[unknown]>(`${selection} EXPLAIN FULL`, { ...params })

  // The plan's root operator, which the reads sit under.
  return readsUnder(planOperator.parse(plan))
}
