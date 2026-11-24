/** `ui-contract inflight`. */

import { contractProblems, editionOf, isBeforeTerms } from '../check'
import { formatProblem, TERMS_FILE } from '../files'
import { contractAt, git } from '../handoff'

/** The branch of the business layer; it is in flight beside the areas' branches. */
const TRUNK = 'contract/trunk'

/** The areas' branches in flight; every other branch, `experiment/*` among them, is not one. */
const AREAS = ['feat/', 'fix/', 'chore/', 'refactor/'] as const

const HEADS = 'refs/heads/'

/** The branch the areas land on, by its full ref: a tag of the same name changes nothing. */
const MAIN = `${HEADS}main`

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
 * Whether `branch` carries nothing `main` lacks: its tree is the tree of its one merge base with
 * `main`, so `git diff main...branch` is empty. Several merge bases, none, no local `main` (read by
 * its exact ref, never a tag of that name) or a failing git call leave that unknown, and a branch
 * not known to carry nothing is checked, never left out.
 */
function hasNothingUnlanded(branch: string, root: string): boolean {
  const ref = `${HEADS}${branch}`
  const treeOf = (rev: string): string => git(root, ['rev-parse', `${rev}^{tree}`]).trim()

  try {
    const main = git(root, ['show-ref', '--verify', '--hash', MAIN]).trim()
    const [base, ...others] = git(root, ['merge-base', '--all', main, ref])
      .split('\n')
      .filter((line) => line !== '')

    return base !== undefined && others.length === 0 && treeOf(base) === treeOf(ref)
  } catch {
    return false
  }
}

/**
 * Whether the merge base of `branch` with `main` holds the terms file: a branch cut after it came
 * that lacks it took it out, and is no branch from before it. Unknown (no one base, no `main`, a
 * failing git call) reads as holding it, so such a branch is checked like any other.
 */
function termsAtBase(branch: string, root: string): boolean {
  try {
    const main = git(root, ['show-ref', '--verify', '--hash', MAIN]).trim()
    const [base, ...others] = git(root, ['merge-base', '--all', main, `${HEADS}${branch}`])
      .split('\n')
      .filter((line) => line !== '')

    if (base === undefined || others.length > 0) {
      return true
    }

    return git(root, ['ls-tree', '--name-only', base, '--', TERMS_FILE]).trim() !== ''
  } catch {
    return true
  }
}

/**
 * What `branch` holds, as lines: its contract loaded with this engine and put through every
 * rule. A contract that does not load, or that a rule cannot read, is that branch's problem.
 */
function report(branch: string, root: string): { lines: string[]; broken: boolean } {
  let problems: string[]

  try {
    // By its ref: a tag of the branch's name stands for no branch.
    const contract = contractAt(`${HEADS}${branch}`, root)

    if ('missing' in contract) {
      return { lines: [`${branch}: no contract`], broken: false }
    }

    // A branch cut before the terms file takes it when it merges `main`: its missing file is no
    // break of an engine landing.
    const before = isBeforeTerms(contract) && !termsAtBase(branch, root)

    problems = contractProblems(contract)
      .filter(({ file }) => !before || file !== TERMS_FILE)
      .map(formatProblem)

    if (problems.length === 0) {
      const terms = before ? ', before the terms file' : ''

      return {
        lines: [`${branch}: OK (version ${editionOf(contract)}${terms})`],
        broken: false,
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    // Read by its ref, printed by its name.
    problems = [message.replaceAll(`${HEADS}${branch}`, branch)]
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
 * as long as the engine reads that version, and one cut before the terms file (none, its roles in
 * the vocabulary, and none at its merge base with `main`) passes without it: the branch takes it
 * when it merges `main`. Every rule of the contract check runs, but not the
 * drift of the generated schemas and reference: a branch's copy of them is no part of its
 * contract. A branch with nothing unlanded, whose tree is that of its one merge base with
 * `main`, is left out, printed as such and neither loaded nor counted: it holds nothing `main`
 * lacks, so a stale one, cut from an older `main`, does not refuse an engine landing. A branch
 * whose merge base git cannot give as one is checked like any other. It only reads the refs:
 * nothing is checked out.
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
  let leftOut = 0

  for (const branch of branches) {
    const leaveOut = hasNothingUnlanded(branch, root)
    const result = leaveOut
      ? { lines: [`${branch}: nothing unlanded, left out`], broken: false }
      : report(branch, root)

    broken += result.broken ? 1 : 0
    leftOut += leaveOut ? 1 : 0

    for (const line of result.lines) {
      console.log(line)
    }
  }

  const checked = branches.length - leftOut
  const left = leftOut > 0 ? `, ${leftOut} left out` : ''

  console.log(`inflight: ${checked} branch${checked === 1 ? '' : 'es'}, ${broken} broken${left}`)

  return broken === 0 ? 0 : 1
}
