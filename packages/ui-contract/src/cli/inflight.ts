/** `ui-contract inflight`. */

import { contractProblems, editionOf } from '../check'
import { formatProblem } from '../files'
import { contractAt, git } from '../handoff'

/** The branch of the business layer; it is in flight beside the areas' branches. */
const TRUNK = 'contract/trunk'

/** The areas' branches in flight; every other branch, `experiment/*` among them, is not one. */
const AREAS = ['feat/', 'fix/', 'chore/', 'refactor/'] as const

const HEADS = 'refs/heads/'

const isInFlight = (branch: string): boolean =>
  branch === TRUNK || AREAS.some((area) => branch.startsWith(area))

/** The local branches in flight, by name. */
const branchesOf = (root: string): string[] =>
  git(root, ['for-each-ref', '--format=%(refname)', HEADS])
    .split('\n')
    .filter((ref) => ref.startsWith(HEADS))
    .map((ref) => ref.slice(HEADS.length))
    .filter(isInFlight)

/**
 * What `branch` holds, as lines: its contract loaded with this engine and put through every
 * rule. A contract that does not load, or that a rule cannot read, is that branch's problem.
 */
function report(branch: string, root: string): { lines: string[]; broken: boolean } {
  let problems: string[]

  try {
    const contract = contractAt(branch, root)

    if ('missing' in contract) {
      return { lines: [`${branch}: no contract`], broken: false }
    }

    problems = contractProblems(contract).map(formatProblem)

    if (problems.length === 0) {
      return { lines: [`${branch}: OK (version ${editionOf(contract)})`], broken: false }
    }
  } catch (error) {
    problems = [error instanceof Error ? error.message : String(error)]
  }

  const count = `${problems.length} problem${problems.length === 1 ? '' : 's'}`

  return {
    lines: [`${branch}: ${count}`, ...problems.map((problem) => `  ${problem}`)],
    broken: true,
  }
}

/**
 * Loads the contract of every local branch in flight, `contract/trunk` and `feat/*`, `fix/*`,
 * `chore/*` and `refactor/*`, with the engine at hand, and prints each branch as OK or with its
 * problems; the exit code is 1 when any branch has one. A contract older than the engine passes
 * as long as the engine reads that version. Every rule of the contract check runs, but not the
 * drift of the generated schemas and reference: a branch's copy of them is no part of its
 * contract. It only reads the refs: nothing is checked out.
 */
export function inflight(argv: readonly string[]): number {
  if (argv.length > 0) {
    console.error('ui-contract: use "inflight"')

    return 1
  }

  const root = process.cwd()
  const branches = branchesOf(root)

  if (branches.length === 0) {
    console.log('inflight: no branch in flight')

    return 0
  }

  let broken = 0

  for (const branch of branches) {
    const result = report(branch, root)

    broken += result.broken ? 1 : 0

    for (const line of result.lines) {
      console.log(line)
    }
  }

  console.log(
    `inflight: ${branches.length} branch${branches.length === 1 ? '' : 'es'}, ${broken} broken`,
  )

  return broken === 0 ? 0 : 1
}
