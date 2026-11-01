/**
 * What a change does to the contract, for its hand-over: the screens, anchors, codes,
 * entities, fields and activities one contract adds or removes against another, the anchors
 * it renames, the codes and the error fields it adds or removes on the anchors both hold
 * (written or derived, so a constraint added to the model shows as the code it gives), the
 * fields that start or stop holding input, the actions that leave what the user typed behind
 * and how each leave that would lose it asks, and the transitions it adds or removes in each
 * activity both contracts hold.
 */

import { type Contract, codesOf, declaredAnchors } from '../check'
import type { Activity, AnchorDef } from '../files'

import { branchesOf } from './activities'

export interface Change {
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
  /** As `<anchor>`, the fields that hold input, on the anchors both contracts hold. */
  inputs: Change
  /** As `<anchor> asks <code>`, the controls that ask before a destructive action. */
  questions: Change
  /** As the action's name, the actions that leave what the user typed behind. */
  leaving: Change
  /** As `<leave>: <how it asks>`, and `question: <dialog>`: how each leave that would lose unsaved input asks first. */
  unsavedInput: Change
  screens: Change
  entities: Change
  /** As `entity.field`. */
  fields: Change
  /** By id; per activity both hold, its transitions as `<state> on <anchor> -> <target>`. */
  activities: Change & { transitions: Record<string, Change> }
}

const byName = (a: string, b: string): number => a.localeCompare(b, 'en')

/** How each leave that would lose unsaved input asks, as `<leave>: <how>`; none when undeclared. */
const unsavedInputOf = (contract: Contract | undefined): string[] =>
  Object.entries(contract?.screens.platform.unsavedInput ?? {}).map(
    ([leave, how]) => `${leave}: ${how}`,
  )

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
      before === undefined ? [] : [...codesOf(before.vocabulary, before.screens)],
      after === undefined ? [] : [...codesOf(after.vocabulary, after.screens)],
    ),
    anchorCodes: carriedChanges(before, after, anchors.renamed, (def) => def.codes ?? []),
    errorFields: carriedChanges(before, after, anchors.renamed, (def) =>
      Object.entries(def.fields ?? {}).map(([code, field]) => `${code} -> ${field}`),
    ),
    inputs: carriedChanges(before, after, anchors.renamed, (def) =>
      def.holdsInput === true ? ['holds input'] : [],
    ),
    questions: carriedChanges(before, after, anchors.renamed, (def) =>
      def.asks === undefined ? [] : [`asks ${def.asks.code}`],
    ),
    leaving: changeOf(
      before?.screens.platform.leaving ?? [],
      after?.screens.platform.leaving ?? [],
    ),
    unsavedInput: changeOf(unsavedInputOf(before), unsavedInputOf(after)),
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
