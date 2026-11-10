/**
 * What a change does to the contract, for its hand-over: the screens, anchors, codes,
 * entities, fields and activities one contract adds or removes against another, the anchors
 * it renames, the derived parts (a password input's visibility-button among them), the
 * composites the platform declares, the codes, the states, the roles and the error fields it
 * adds or removes on the anchors both hold (written or derived, so a constraint added to the
 * model shows as the code it gives), who each route serves (its guard and its roles), the
 * platform action each list reads with its params and its paging, the fields that start or stop
 * holding input, the messages that
 * rank their codes, with their order, the actions that
 * leave what the user typed behind and how each leave that would lose it asks, the notices the
 * platform actions declare, the transitions it adds or removes in each activity both contracts
 * hold, the lines of the flow it adds or removes in each screen both hold (a flow added or
 * removed whole, every line; so a contract written shorter that loads to the same flows shows no
 * change), the platform actions it adds or removes, the lines of each platform action it adds,
 * removes or changes (its parameters, result, codes, roles, mail and notices), and each
 * description the files write that it adds, removes or changes, with its length on each side.
 */

import { type Contract, codesOf, declaredAnchors } from '../check'
import type { Activity, AnchorDef, Flow } from '../files'

import { actionLines } from './action-lines'
import { branchesOf } from './activities'
import { byName, type Change, changeOf } from './change'
import { type DescriptionChange, descriptionChanges } from './description-changes'
import { flowLines } from './flow-lines'
import { routeAccessLines } from './route-access'
import { sourceLines } from './source-lines'

export interface ContractChanges {
  anchors: Change & { renamed: Array<{ from: string; to: string }> }
  /** As `<anchor>.<suffix>`, the derived parts the anchors both contracts hold render. */
  derived: Change
  /** By name, the composites the platform declares. */
  composites: Change
  codes: Change
  /** As `<anchor> <code>`, on the anchors both contracts hold (a renamed one by its new name). */
  anchorCodes: Change
  /** As `<anchor> <state>`, the data-states of the anchors both contracts hold, renamed as above. */
  anchorStates: Change
  /** As `<anchor> <role>`, the roles each anchor both contracts hold is shown to, renamed as above. */
  anchorRoles: Change
  /** As `<error> <code> -> <field>`, on the errors both contracts hold. */
  errorFields: Change
  /** As `<anchor>`, the fields that hold input, on the anchors both contracts hold. */
  inputs: Change
  /** As `<anchor> asks <code>`, the controls that ask before a destructive action. */
  questions: Change
  /**
   * As `<anchor> ranks <code> > <code>`, the messages that rank their codes, each with its order:
   * a new order shows as the old line removed and the new one added.
   */
  ranks: Change
  /** As the action's name, the actions that leave what the user typed behind. */
  leaving: Change
  /** As `<leave>: <how it asks>`, and `question: <dialog>`: how each leave that would lose unsaved input asks first. */
  unsavedInput: Change
  /** As `<action>.<name>`, the notices the platform actions declare. */
  notices: Change
  screens: Change
  /** As `<path> guard <guard>` and `<path> serves <role>`, who each route serves (`routeAccessLines`). */
  routeAccess: Change
  /** As `<anchor> reads platform.<action> [<param>=...] [paged]`, each list's source (`sourceLines`). */
  sources: Change
  entities: Change
  /** As `entity.field`. */
  fields: Change
  /** By id; per activity both hold, its transitions as `<state> on <anchor> -> <target>`. */
  activities: Change & { transitions: Record<string, Change> }
  /**
   * Per screen both contracts hold with a flow on either side, by its id, the lines of the flow
   * (`flowLines`: initial states, the codes each guard by failure code takes, addresses,
   * entries, exits, transitions with their targets, guards and effects, invokes and their
   * outcomes, final states; descriptions and guard sentences aside), a flow
   * one side lacks having none.
   */
  flows: Record<string, Change>
  /** By name, the platform actions. */
  actions: Change
  /**
   * Per platform action either contract holds, by its name, the lines of the action
   * (`actionLines`: its parameters with their types, its result, its codes, its roles, its mail
   * and its notices; descriptions aside), an action one side lacks having none, so an action
   * added or removed whole shows every line: nothing else in the summary says its mail.
   */
  actionLines: Record<string, Change>
  /** By place, each written description added, removed or changed, with its length on each side. */
  descriptions: DescriptionChange[]
}

/** The platform actions of a contract by name; none for a contract left undefined. */
const actionsOf = (contract: Contract | undefined) => contract?.screens.platform.actions ?? {}

/** Per platform action either contract holds, by its name, the lines added and removed. */
function actionLineChanges(
  before: Contract | undefined,
  after: Contract | undefined,
): ContractChanges['actionLines'] {
  const was = actionsOf(before)
  const is = actionsOf(after)
  const names = [...new Set([...Object.keys(was), ...Object.keys(is)])].sort(byName)

  return Object.fromEntries(
    names.map((name) => [name, changeOf(actionLines(was[name]), actionLines(is[name]))]),
  )
}

/** How each leave that would lose unsaved input asks, as `<leave>: <how>`; none when undeclared. */
const unsavedInputOf = (contract: Contract | undefined): string[] =>
  Object.entries(contract?.screens.platform.unsavedInput ?? {}).map(
    ([leave, how]) => `${leave}: ${how}`,
  )

/** The notices the platform actions declare, as `<action>.<name>`; none when undeclared. */
const noticesOf = (contract: Contract | undefined): string[] =>
  Object.entries(contract?.screens.platform.actions ?? {}).flatMap(([action, { notices }]) =>
    (notices ?? []).map(({ name }) => `${action}.${name}`),
  )

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
 * What `entriesOf` lists of each anchor both contracts hold, as `<anchor> <entry>` (or with
 * another separator), added and removed; an anchor renamed is held by both under its new name.
 */
function carriedChanges(
  before: Contract | undefined,
  after: Contract | undefined,
  renamed: ReadonlyArray<{ from: string; to: string }>,
  entriesOf: (def: AnchorDef) => readonly string[],
  separator = ' ',
): Change {
  const to = new Map(renamed.map(({ from, to: name }) => [from, name]))
  const was = new Map([...defsOf(before)].map(([anchor, def]) => [to.get(anchor) ?? anchor, def]))
  const is = defsOf(after)
  const listed = (defs: Map<string, AnchorDef>, other: Map<string, AnchorDef>) =>
    [...defs].flatMap(([anchor, def]) =>
      other.has(anchor) ? entriesOf(def).map((entry) => `${anchor}${separator}${entry}`) : [],
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

/** Each screen's flow, by the screen's id, undefined for a screen without one. */
const flowsOf = (contract: Contract | undefined): Map<string, Flow | undefined> =>
  new Map((contract?.screens.screens ?? []).map(({ id, flow }) => [id, flow]))

/** The lines of a flow, none for a screen without one. */
const linesOf = (flow: Flow | undefined): string[] => (flow === undefined ? [] : flowLines(flow))

/**
 * Per screen both contracts hold, with a flow on either side, the lines of the flow added and
 * removed: a flow one side lacks has no lines, so a flow added or removed whole shows every line.
 * A screen added or removed whole is a change of `screens` alone.
 */
function flowChanges(
  before: Contract | undefined,
  after: Contract | undefined,
): ContractChanges['flows'] {
  const was = flowsOf(before)

  return Object.fromEntries(
    [...flowsOf(after)].flatMap(([id, flow]) => {
      const old = was.get(id)

      return !was.has(id) || (old === undefined && flow === undefined)
        ? []
        : [[id, changeOf(linesOf(old), linesOf(flow))]]
    }),
  )
}

/** The changes from `before` to `after`; a contract left undefined is an empty one. */
export function diffContracts(
  before: Contract | undefined,
  after: Contract | undefined,
): ContractChanges {
  const anchors = anchorChanges(before, after)

  return {
    anchors,
    derived: carriedChanges(before, after, anchors.renamed, (def) => def.derived ?? [], '.'),
    composites: changeOf(
      Object.keys(before?.screens.platform.composites ?? {}),
      Object.keys(after?.screens.platform.composites ?? {}),
    ),
    codes: changeOf(
      before === undefined ? [] : [...codesOf(before.vocabulary, before.screens)],
      after === undefined ? [] : [...codesOf(after.vocabulary, after.screens)],
    ),
    anchorCodes: carriedChanges(before, after, anchors.renamed, (def) => def.codes ?? []),
    anchorStates: carriedChanges(before, after, anchors.renamed, (def) => def.states ?? []),
    anchorRoles: carriedChanges(before, after, anchors.renamed, (def) => def.roles ?? []),
    errorFields: carriedChanges(before, after, anchors.renamed, (def) =>
      Object.entries(def.fields ?? {}).map(([code, field]) => `${code} -> ${field}`),
    ),
    inputs: carriedChanges(before, after, anchors.renamed, (def) =>
      def.holdsInput === true ? ['holds input'] : [],
    ),
    questions: carriedChanges(before, after, anchors.renamed, (def) =>
      def.asks === undefined ? [] : [`asks ${def.asks.code}`],
    ),
    ranks: carriedChanges(before, after, anchors.renamed, (def) =>
      def.ranked === true ? [`ranks ${(def.codes ?? []).join(' > ')}`] : [],
    ),
    leaving: changeOf(
      before?.screens.platform.leaving ?? [],
      after?.screens.platform.leaving ?? [],
    ),
    unsavedInput: changeOf(unsavedInputOf(before), unsavedInputOf(after)),
    notices: changeOf(noticesOf(before), noticesOf(after)),
    screens: changeOf(
      (before?.screens.screens ?? []).map(({ id }) => id),
      (after?.screens.screens ?? []).map(({ id }) => id),
    ),
    routeAccess: changeOf(routeAccessLines(before), routeAccessLines(after)),
    sources: changeOf(sourceLines(before), sourceLines(after)),
    entities: changeOf(
      Object.keys(before?.model.entities ?? {}),
      Object.keys(after?.model.entities ?? {}),
    ),
    fields: changeOf(fieldsOf(before), fieldsOf(after)),
    activities: activityChanges(before, after),
    flows: flowChanges(before, after),
    actions: changeOf(Object.keys(actionsOf(before)), Object.keys(actionsOf(after))),
    actionLines: actionLineChanges(before, after),
    descriptions: descriptionChanges(before, after, anchors.renamed),
  }
}
