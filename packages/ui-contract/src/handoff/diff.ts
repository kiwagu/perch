/**
 * What a change does to the contract, for its hand-over: the screens, anchors, codes,
 * entities, fields and activities one contract adds or removes against another, the anchors
 * it renames, the codes and the error fields it adds or removes on the anchors both hold
 * (written or derived, so a constraint added to the model shows as the code it gives), and the
 * transitions it adds or removes in each activity both contracts hold.
 * `contractAt` reads the contract files, the activities and the scenarios at a git ref.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { type Contract, declaredAnchors, loadContract } from '../check'
import {
  ACTIVITIES_DIR,
  type Activity,
  type AnchorDef,
  CONTRACT_DIR,
  formatProblem,
  MODEL_FILE,
  PLATFORM_FILE,
  SCENARIOS_DIR,
  SCREENS_DIR,
  VOCABULARY_FILE,
} from '../files'

import { branchesOf } from './activities'

interface Change {
  added: string[]
  removed: string[]
}

export interface ContractChanges {
  anchors: Change & { renamed: Array<{ from: string; to: string }> }
  codes: Change
  /** As `<anchor> <code>`, on the anchors both contracts hold (a renamed one by its new name). */
  anchorCodes: Change
  /** As `<error> <code> -> <field>`, on the errors both contracts hold. */
  errorFields: Change
  screens: Change
  entities: Change
  /** As `entity.field`. */
  fields: Change
  /** By id; per activity both hold, its transitions as `<state> on <anchor> -> <target>`. */
  activities: Change & { transitions: Record<string, Change> }
}

const FILES = [VOCABULARY_FILE, PLATFORM_FILE, MODEL_FILE] as const

/** The folders whose every file belongs to the contract, at any depth. */
const FOLDERS = [SCREENS_DIR, ACTIVITIES_DIR, SCENARIOS_DIR] as const

const git = (root: string, args: readonly string[]): string =>
  execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

/** Writes `file` as it is at `ref` into the folder `temp`. */
function copyAt(root: string, ref: string, file: string, temp: string): void {
  let text: string

  try {
    text = git(root, ['show', `${ref}:${file}`])
  } catch {
    throw new Error(`${ref} has no ${file}`)
  }

  mkdirSync(dirname(join(temp, file)), { recursive: true })
  writeFileSync(join(temp, file), text)
}

/**
 * The contract at `ref` of the repository at `root`, or `missing` when that commit has no
 * `contract/` folder. A ref that names no commit, and a contract there that does not load,
 * are errors.
 */
export function contractAt(ref: string, root: string): Contract | { missing: true } {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  } catch {
    throw new Error(`"${ref}" names no commit`)
  }

  if (git(root, ['ls-tree', '--name-only', ref, '--', `${CONTRACT_DIR}/`]).trim() === '') {
    return { missing: true }
  }

  const temp = mkdtempSync(join(tmpdir(), 'ui-contract-diff-'))

  try {
    const folders = FOLDERS.map((dir) => `${dir}/`)
    const listed = git(root, ['ls-tree', '-r', '--name-only', ref, '--', ...folders])
      .split('\n')
      .filter((file) => file !== '')

    for (const file of [...FILES, ...listed]) {
      copyAt(root, ref, file, temp)
    }

    const { contract, problems } = loadContract(temp)

    if (contract === undefined) {
      const printed = problems.map(formatProblem).join('; ')

      throw new Error(`the contract at ${ref} does not load: ${printed}`)
    }

    return contract
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'en')

function changeOf(before: readonly string[], after: readonly string[]): Change {
  const was = new Set(before)
  const is = new Set(after)

  return {
    added: [...is].filter((name) => !was.has(name)).sort(byName),
    removed: [...was].filter((name) => !is.has(name)).sort(byName),
  }
}

/** Each anchor with the screen it is declared in and its kind. */
const anchorsOf = (contract: Contract | undefined): Map<string, string> =>
  new Map(
    contract === undefined
      ? []
      : declaredAnchors(contract.screens).map(({ anchor, def, screen }) => [
          anchor,
          `${screen.id} ${def.kind}`,
        ]),
  )

/** The names by the screen and kind `place` gives each of them. */
function groupOf(names: readonly string[], place: ReadonlyMap<string, string>) {
  const groups = new Map<string, string[]>()

  for (const name of names) {
    const group = place.get(name) ?? ''

    groups.set(group, [...(groups.get(group) ?? []), name])
  }

  return groups
}

/**
 * The anchors removed and added, with a rename wherever a screen and kind lost exactly one
 * anchor and gained exactly one: with more on either side the pairing would be a guess, so
 * they stay removed and added.
 */
function anchorChanges(before: Contract | undefined, after: Contract | undefined) {
  const was = anchorsOf(before)
  const is = anchorsOf(after)
  const { added, removed } = changeOf([...was.keys()], [...is.keys()])
  const gained = groupOf(added, is)
  const renamed: Array<{ from: string; to: string }> = []

  for (const [group, lost] of groupOf(removed, was)) {
    const [from] = lost
    const [to, ...more] = gained.get(group) ?? []

    if (from !== undefined && to !== undefined && lost.length === 1 && more.length === 0) {
      renamed.push({ from, to })
    }
  }

  const paired = new Set(renamed.flatMap(({ from, to }) => [from, to]))

  return {
    added: added.filter((name) => !paired.has(name)),
    removed: removed.filter((name) => !paired.has(name)),
    renamed: renamed.sort((a, b) => byName(a.from, b.from)),
  }
}

/** Each anchor's definition, by its name. */
const defsOf = (contract: Contract | undefined): Map<string, AnchorDef> =>
  new Map(
    contract === undefined
      ? []
      : declaredAnchors(contract.screens).map(({ anchor, def }) => [anchor, def]),
  )

/**
 * What `entriesOf` lists of each anchor both contracts hold, as `<anchor> <entry>`, added and
 * removed; an anchor renamed is held by both under its new name.
 */
function carriedChanges(
  before: Contract | undefined,
  after: Contract | undefined,
  renamed: ReadonlyArray<{ from: string; to: string }>,
  entriesOf: (def: AnchorDef) => readonly string[],
): Change {
  const to = new Map(renamed.map(({ from, to: name }) => [from, name]))
  const was = new Map([...defsOf(before)].map(([anchor, def]) => [to.get(anchor) ?? anchor, def]))
  const is = defsOf(after)
  const listed = (defs: Map<string, AnchorDef>, other: Map<string, AnchorDef>) =>
    [...defs].flatMap(([anchor, def]) =>
      other.has(anchor) ? entriesOf(def).map((entry) => `${anchor} ${entry}`) : [],
    )

  return changeOf(listed(was, is), listed(is, was))
}

const fieldsOf = (contract: Contract | undefined): string[] =>
  Object.values(contract?.model.entities ?? {}).flatMap(({ name, fields }) =>
    Object.keys(fields).map((field) => `${name}.${field}`),
  )

/** The activities added and removed, and the transitions changed in each one both hold. */
function activityChanges(
  before: Contract | undefined,
  after: Contract | undefined,
): ContractChanges['activities'] {
  const was = new Map((before?.activities ?? []).map((activity) => [activity.id, activity]))
  const is = new Map((after?.activities ?? []).map((activity) => [activity.id, activity]))
  const transitionsOf = (activity: Activity): string[] =>
    branchesOf(activity).map(({ state, anchor, target }) => `${state} on ${anchor} -> ${target}`)

  return {
    ...changeOf([...was.keys()], [...is.keys()]),
    transitions: Object.fromEntries(
      [...is].flatMap(([id, activity]) => {
        const old = was.get(id)

        return old === undefined
          ? []
          : [[id, changeOf(transitionsOf(old), transitionsOf(activity))]]
      }),
    ),
  }
}

/** The changes from `before` to `after`; a contract left undefined is an empty one. */
export function diffContracts(
  before: Contract | undefined,
  after: Contract | undefined,
): ContractChanges {
  const anchors = anchorChanges(before, after)

  return {
    anchors,
    codes: changeOf(
      Object.keys(before?.vocabulary.codes ?? {}),
      Object.keys(after?.vocabulary.codes ?? {}),
    ),
    anchorCodes: carriedChanges(before, after, anchors.renamed, (def) => def.codes ?? []),
    errorFields: carriedChanges(before, after, anchors.renamed, (def) =>
      Object.entries(def.fields ?? {}).map(([code, field]) => `${code} -> ${field}`),
    ),
    screens: changeOf(
      (before?.screens.screens ?? []).map(({ id }) => id),
      (after?.screens.screens ?? []).map(({ id }) => id),
    ),
    entities: changeOf(
      Object.keys(before?.model.entities ?? {}),
      Object.keys(after?.model.entities ?? {}),
    ),
    fields: changeOf(fieldsOf(before), fieldsOf(after)),
    activities: activityChanges(before, after),
  }
}

/** The lists in the order of the block, each with its singular and plural noun. */
const LISTS = [
  ['screens', 'screen', 'screens'],
  ['anchors', 'anchor', 'anchors'],
  ['codes', 'code', 'codes'],
  ['anchorCodes', 'anchor code', 'anchor codes'],
  ['errorFields', 'error field', 'error fields'],
  ['entities', 'entity', 'entities'],
  ['fields', 'field', 'fields'],
  ['activities', 'activity', 'activities'],
] as const

/** The non-empty lists of one change: its count and its entries, after `where` when given. */
function linesOf(
  change: Change | ContractChanges['anchors'],
  one: string,
  many: string,
  where = '',
) {
  const lists: Array<{ verb: string; entries: string[] }> = [
    { verb: 'added', entries: change.added },
    { verb: 'removed', entries: change.removed },
    ...('renamed' in change
      ? [{ verb: 'renamed', entries: change.renamed.map(({ from, to }) => `${from} -> ${to}`) }]
      : []),
  ]

  return lists
    .filter(({ entries }) => entries.length > 0)
    .map(({ verb, entries }) => ({
      summary: `${entries.length} ${entries.length === 1 ? one : many} ${verb}${where}`,
      line: `${many} ${verb}${where}: ${entries.join(', ')}`,
    }))
}

/** Each non-empty list (`anchors renamed`), then the transitions changed in each activity. */
const listsOf = (changes: ContractChanges) => [
  ...LISTS.flatMap(([key, one, many]) => linesOf(changes[key], one, many)),
  ...Object.entries(changes.activities.transitions).flatMap(([id, change]) =>
    linesOf(change, 'transition', 'transitions', ` in ${id}`),
  ),
]

/** The hand-over block: a summary line, then one line per list that is not empty. */
export function formatChanges(changes: ContractChanges): string {
  const lists = listsOf(changes)

  if (lists.length === 0) {
    return 'contract changes: none'
  }

  return [
    `contract changes: ${lists.map(({ summary }) => summary).join(', ')}`,
    ...lists.map(({ line }) => line),
  ].join('\n')
}
