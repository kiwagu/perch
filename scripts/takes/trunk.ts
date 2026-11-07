/**
 * The trunk commits a take's trailer names, checked against the trunk: each on its own line (its
 * first parents since `main`), a run's first not after its last and each before the next, and
 * every file the take stages one they change.
 */

import { git } from '../staged-commit.ts'

import { CARD, listed, TAKEN, TAKEN_FORM, TRUNK } from './form.ts'

const COMMIT = /^[0-9a-f]{7,40}$/

const RUN = /^([0-9a-f]{7,40})\^\.\.([0-9a-f]{7,40})$/

/** One item of a take's trailer: a commit, or a run from `first` to `last`, both included. */
interface Item {
  readonly label: string
  readonly first: string
  readonly last: string
}

/** Every ref of `refs` the clone has, or undefined when git fails. */
function existing(refs: readonly string[]): readonly string[] | undefined {
  const found: string[] = []

  for (const ref of refs) {
    const { status } = git(['rev-parse', '--verify', '--quiet', ref])

    if (status === 0) {
      found.push(ref)
    } else if (status !== 1) {
      return undefined
    }
  }

  return found
}

/** Whether `ancestor` is `descendant` or one of its ancestors, or undefined when git fails. */
function isAncestor(ancestor: string, descendant: string): boolean | undefined {
  const { status } = git(['merge-base', '--is-ancestor', ancestor, descendant])

  return status === 0 ? true : status === 1 ? false : undefined
}

/** The lines a git command printed, or undefined when it failed. */
function lines(args: readonly string[]): readonly string[] | undefined {
  const { status, out } = git(args)

  return status === 0 ? out.split(/[\n\0]/).filter((line) => line !== '') : undefined
}

/** The full commit `name` is, or undefined when git knows none. */
function commitOf(name: string): string | undefined {
  const { status, out } = git(['rev-parse', '--verify', '--quiet', `${name}^{commit}`])

  return status === 0 ? out.trim() : undefined
}

/** The items a take's trailer names, or undefined when it is not in its form. */
function itemsOf(value: string): readonly string[] | undefined {
  const [branch, ...rest] = value.split(/\s+/).filter((token) => token !== '')
  const count = rest.findIndex((token) => !COMMIT.test(token) && !RUN.test(token))
  const items = count === -1 ? rest : rest.slice(0, count)
  const cards = count === -1 ? [] : rest.slice(count)
  const formed = items.length > 0 && cards.length > 0 && cards.every((card) => CARD.test(card))

  return branch === TRUNK && formed ? items : undefined
}

/** The commits of the trunk's own line, or what is wrong with the clone's trunk. */
function ownLine(): ReadonlySet<string> | string {
  const trunks = existing([`refs/heads/${TRUNK}`, `refs/remotes/origin/${TRUNK}`])
  const mains = existing(['refs/heads/main', 'refs/remotes/origin/main'])

  if (trunks === undefined || mains === undefined) {
    return 'git cannot read its branches.'
  }

  if (trunks.length === 0) {
    return `git knows no ${TRUNK} in this clone: git fetch origin ${TRUNK}, then commit again.`
  }

  if (mains.length === 0) {
    return `git knows no main in this clone, which tells ${TRUNK}'s own commits from those it took from main: git fetch origin main, then commit again.`
  }

  const own = lines(['rev-list', '--first-parent', '--no-merges', ...trunks, '--not', ...mains])

  return own === undefined ? `git cannot read ${TRUNK}.` : new Set(own)
}

/** The items of a take, each on the trunk's own line and in order, or what is wrong with them. */
function resolve(labels: readonly string[]): readonly Item[] | string {
  const line = ownLine()

  if (typeof line === 'string') {
    return line
  }

  const items: Item[] = []

  for (const label of labels) {
    const [from, to] = (RUN.exec(label)?.slice(1) ?? [label, label]).map((name) => commitOf(name))

    if (from === undefined || to === undefined) {
      return `it names ${label}, which git does not know here.`
    }

    if (!line.has(from) || !line.has(to)) {
      return `it names ${label}, which is no commit of ${TRUNK}'s own line (its first parents since main).`
    }

    if (isAncestor(from, to) !== true) {
      return `the run ${label} starts after it ends.`
    }

    const before = items.at(-1)

    if (before !== undefined && (before.last === from || isAncestor(before.last, from) !== true)) {
      return `it names the trunk's commits oldest first, each once, and ${label} does not come after ${before.label}.`
    }

    items.push({ label, first: from, last: to })
  }

  return items
}

/** The files the commits of `items` change, or undefined when git cannot read them. */
function brought(items: readonly Item[]): ReadonlySet<string> | undefined {
  const files = new Set<string>()

  for (const { first, last } of items) {
    const commits = lines(['rev-list', '--first-parent', '--no-merges', `${first}^..${last}`])

    if (commits === undefined) {
      return undefined
    }

    for (const commit of commits) {
      const changed = lines([
        'diff-tree',
        '--no-commit-id',
        '--name-only',
        '-r',
        '--no-renames',
        '--ignore-submodules=none',
        '-z',
        commit,
      ])

      if (changed === undefined) {
        return undefined
      }

      for (const file of changed) {
        files.add(file)
      }
    }
  }

  return files
}

/** What is wrong with a take's trailer `value`, for a take that stages `files`. */
export function takenProblems(value: string, files: readonly string[]): readonly string[] {
  const labels = itemsOf(value)

  if (labels === undefined) {
    return [
      `its trailer reads "${TAKEN_FORM}", each commit or run oldest first, then each card: "${TAKEN}: ${value}" is not.`,
    ]
  }

  const items = resolve(labels)

  if (typeof items === 'string') {
    return [items]
  }

  const changed = brought(items)

  if (changed === undefined) {
    return [`git cannot read the commits of ${TRUNK} it names.`]
  }

  const stray = files.filter((file) => !changed.has(file))

  return stray.length === 0
    ? []
    : [
        `it stages files none of the trunk's commits it names change; what the take needs beyond them goes on ${TRUNK} under the card, taken as one more commit:\n${listed(stray)}`,
      ]
}
