/**
 * The round of a branch: the commits of its tip that `main` has not got and no earlier landing on
 * `main` carried, read from the `Squashed-from` trailers of `main`'s history, which name the tip
 * each landing squashed; a named tip the clone lacks is left out, and said.
 */

import { git } from '../staged-commit.ts'

import { COLON_TRAILERS, SQUASHED } from './form.ts'

/** What a landing's trailer names: the branch it squashed, the branch's tip, and its cards. */
export interface Landed {
  readonly branch: string
  readonly tip: string
  readonly cards: readonly string[]
}

/** What git says of a name it looks up: a commit it has, none, or more than one it could be. */
export type Lookup = 'found' | 'missing' | 'ambiguous'

/** The commits of a round, oldest first, and the tips of earlier landings the clone lacks. */
export interface Round {
  readonly commits: readonly string[]
  readonly missing: readonly string[]
}

const LANDED = /^(\S+) \(([0-9a-f]{7,40})\)((?: [A-Z][A-Z0-9]*-[1-9][0-9]*)*)$/

/** What the `Squashed-from` trailer's `value` names, or undefined when it is not in its form. */
export function parseSquashed(value: string): Landed | undefined {
  const [, branch, tip, cards] = LANDED.exec(value.trim()) ?? []

  if (branch === undefined || tip === undefined) {
    return undefined
  }

  return { branch, tip, cards: (cards ?? '').split(' ').filter((card) => card !== '') }
}

/**
 * What one line of `git cat-file --batch-check` says of the name it answers: a commit found;
 * missing, when the clone has no object by it, or one that is no commit; or ambiguous.
 */
export function lookupOf(line: string): Lookup {
  if (line.endsWith(' missing')) {
    return 'missing'
  }

  if (line.endsWith(' ambiguous')) {
    return 'ambiguous'
  }

  return line.split(' ')[1] === 'commit' ? 'found' : 'missing'
}

/** What separates the values of one commit's trailers in `git log`'s output: `%x1f` there. */
const SEPARATOR = '\u001f'

/** The tips the landings on `parent`'s history name, oldest first, each once, or undefined when git fails. */
function landedTips(parent: string): readonly string[] | undefined {
  const { status, out } = git([
    ...COLON_TRAILERS,
    'log',
    '--no-show-signature',
    '--reverse',
    parent,
    `--format=%(trailers:key=${SQUASHED},valueonly,unfold,separator=%x1f)`,
  ])

  if (status !== 0) {
    return undefined
  }

  const tips = out
    .split('\n')
    .flatMap((line) => line.split(SEPARATOR))
    .map((value) => parseSquashed(value)?.tip)
    .filter((tip): tip is string => tip !== undefined)

  return [...new Set(tips)]
}

/**
 * The full ids of the commits among `tips` the clone has, and the tips it lacks, or what git
 * could not do. Each tip is looked up as written, among commits: a short id shared by a commit
 * and another object names the commit, one shared by two commits is ambiguous (asked for as
 * `<tip>^{commit}`, git would answer `missing` to it).
 */
function lookedUp(
  tips: readonly string[],
): { readonly found: readonly string[]; readonly missing: readonly string[] } | string {
  if (tips.length === 0) {
    return { found: [], missing: [] }
  }

  const { status, out } = git(
    ['-c', 'core.disambiguate=commit', 'cat-file', '--batch-check'],
    tips.map((tip) => `${tip}\n`).join(''),
  )
  const lines = out.split('\n').filter((line) => line !== '')

  if (status !== 0 || lines.length !== tips.length) {
    return 'git cannot look up the tips the earlier landings name.'
  }

  const found: string[] = []
  const missing: string[] = []

  for (const [index, line] of lines.entries()) {
    const tip = tips[index] ?? ''
    const lookup = lookupOf(line)

    if (lookup === 'ambiguous') {
      return `an earlier landing names ${tip}, which git cannot tell from another commit.`
    }

    if (lookup === 'missing') {
      missing.push(tip)
    } else {
      found.push(line.slice(0, line.indexOf(' ')))
    }
  }

  return { found, missing }
}

/**
 * The commits of `tip` that `parent` has not got and no landing on `parent`'s history carried,
 * merges left out, oldest first, with the earlier tips the clone lacks; or what git could not do.
 */
export function roundOf(tip: string, parent: string): Round | string {
  const tips = landedTips(parent)

  if (tips === undefined) {
    return `git cannot read the landings on ${parent}.`
  }

  const earlier = lookedUp(tips)

  if (typeof earlier === 'string') {
    return earlier
  }

  const { status, out } = git(
    ['rev-list', '--reverse', '--no-merges', '--stdin'],
    [tip, `^${parent}`, ...earlier.found.map((id) => `^${id}`)].map((rev) => `${rev}\n`).join(''),
  )

  if (status !== 0) {
    return `git cannot list the commits of ${tip} since ${parent}.`
  }

  return { commits: out.split('\n').filter((line) => line !== ''), missing: earlier.missing }
}
