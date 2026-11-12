/**
 * Rule 19: the reads an action changes. Every platform action, and every action of the model
 * under `x-perch.actions`, says under `changes` (its schema wants it) which reads answer
 * otherwise once it succeeds, for the organisation, the account and the params it ran with: each
 * a platform action, never the action itself (an action changes what other reads answer), that
 * a list, a section or a table of some screen takes as its `source`, named once. `[]` says it
 * changes none. A problem is placed at the offending name, in the platform file or in the model.
 * The flow holds a read after an action that changes a list of its screen (`flow/held-reads.ts`).
 */

import { jsonPath, MODEL_FILE, type Problem } from '../files'

import { type Contract, declaredAnchors, has, locate } from './contract'

/** What `changes` names: each problem of a name it should not hold says it. */
const CHANGES_NAMES =
  'changes names the reads whose answer differs once the action succeeds: other platform actions, each once, that a list, a section or a table takes as its source'

/** The platform actions some anchor takes as its `source`. */
const sourcesOf = ({ screens }: Contract): Set<string> =>
  new Set(
    declaredAnchors(screens).flatMap(({ def: { source } }) =>
      source !== undefined && 'platform' in source ? [source.platform] : [],
    ),
  )

/** What reads the names of one action's `changes`: the platform, the sources, its own name. */
interface Reading {
  readonly actions: Contract['screens']['platform']['actions']
  readonly sources: ReadonlySet<string>
  /** The action's own name, for a platform action; a model action's is never a read. */
  readonly self?: string
}

/** Why the name at `index` of `changes` should not be there, or undefined when it should. */
function whyNot(
  { actions, sources, self }: Reading,
  changes: readonly string[],
  index: number,
): string | undefined {
  const name = changes[index] ?? ''

  if (changes.indexOf(name) < index) {
    return 'is named twice'
  }

  if (!has(actions, name)) {
    return 'is not a platform action'
  }

  if (name === self) {
    return 'is the action itself'
  }

  return sources.has(name) ? undefined : 'is the source of no list, section or table'
}

/** Each name of one action's `changes` that should not be there, by its index, with why. */
const namesProblems = (
  reading: Reading,
  changes: readonly string[],
): Array<{ index: number; message: string }> =>
  changes.flatMap((name, index) => {
    const why = whyNot(reading, changes, index)

    return why === undefined ? [] : [{ index, message: `"${name}" ${why}: ${CHANGES_NAMES}` }]
  })

export function changesProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)
  const { actions } = contract.screens.platform
  const sources = sourcesOf(contract)

  return [
    ...Object.entries(actions).flatMap(([name, { changes }]) =>
      namesProblems({ actions, sources, self: name }, changes).map(({ index, message }) =>
        inScreens(['platform', 'actions', name, 'changes', index], message),
      ),
    ),
    ...Object.values(contract.model.entities).flatMap((entity) =>
      Object.entries(entity.actions).flatMap(([action, { changes }]) =>
        namesProblems({ actions, sources }, changes).map(({ index, message }) => ({
          file: MODEL_FILE,
          message: `${jsonPath(['$defs', entity.name, 'x-perch', 'actions', action, 'changes', index])}: ${message}`,
        })),
      ),
    ),
  ]
}
