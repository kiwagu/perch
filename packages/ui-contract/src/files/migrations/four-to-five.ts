/**
 * Version 4 to 5: from version 5 the success of a button's region clears its area's error,
 * `<part>.error`, as the first effect of every branch of its `onDone` that neither shows nor
 * clears it, and a screen file never writes that clear there. A region written `by: <button>`
 * whose part has its error loses the clear of it that such a branch writes first, exactly where
 * the loader now derives it, with the branch's `actions` when it held nothing else. A clear of it
 * after another effect stays as written and is named: the loader refuses it, and dropping it moves
 * the clear first, which is the author's to decide. A clear of another anchor, one in a branch
 * that shows the error, and one in a region written in full stay as they are.
 */

import type { Document } from 'yaml'

import { entriesOf, isRecord, recordOf } from '../../records'
import { controlsOf } from '../derive'
import { jsonPath } from '../problems'

import type { Migration } from './migration'
import { fileOf, type Plain, plainOf, type ScreenDocuments } from './screens'

type Path = readonly (string | number)[]

/** The anchor an effect as a file writes it shows or clears (by `type`), in full or by its name. */
function anchorOf(effect: unknown, type: 'show' | 'clear'): string | undefined {
  const written = recordOf(effect)

  if (written['type'] !== undefined) {
    const { anchor } = recordOf(written['params'])

    return written['type'] === type && typeof anchor === 'string' ? anchor : undefined
  }

  const value = Object.keys(written).length === 1 ? written[type] : undefined

  if (typeof value === 'string') {
    return value
  }

  // `show: { <anchor>: [codes] }` names its one anchor.
  const named = type === 'show' && isRecord(value) ? Object.keys(value) : []

  return named.length === 1 ? named[0] : undefined
}

/**
 * The regions written `by` a button, each at its path: the regions of a parallel state of the
 * root, which is where the loader expands them.
 */
const buttonRegionsOf = (screen: Plain): Array<{ at: Path; region: Plain }> =>
  entriesOf(recordOf(screen['flow'])['states']).flatMap(([name, state]) =>
    recordOf(state)['type'] === 'parallel'
      ? entriesOf(recordOf(state)['states']).flatMap(([region, written]) =>
          isRecord(written) && written['by'] !== undefined && written['pattern'] === undefined
            ? [{ at: ['flow', 'states', name, 'states', region], region: written }]
            : [],
        )
      : [],
  )

/** The branches of an `onDone`, each at its path. */
const branchesOf = (done: unknown, at: Path): Array<[Path, unknown]> =>
  Array.isArray(done)
    ? done.map((branch: unknown, index): [Path, unknown] => [[...at, index], branch])
    : [[at, done]]

/**
 * What a branch of an `onDone` does with the clear of `error` the loader derives there: drops it
 * when the branch writes it first, and returns a line for each one it writes after another effect.
 */
function dropFromBranch(
  document: Document,
  file: string,
  where: Path,
  branch: unknown,
  error: string,
): string[] {
  const actions = recordOf(branch)['actions']

  if (!Array.isArray(actions) || actions.some((effect) => anchorOf(effect, 'show') === error)) {
    return []
  }

  const clearing = actions.flatMap((effect: unknown, index) =>
    anchorOf(effect, 'clear') === error ? [index] : [],
  )

  const dropped = clearing[0] === 0

  if (dropped) {
    document.deleteIn(actions.length === 1 ? [...where, 'actions'] : [...where, 'actions', 0])
  }

  // Each one left is named where it stands once the first is gone.
  return clearing
    .filter((index) => index > 0)
    .map(
      (index) =>
        `${file}: ${jsonPath([...where, 'actions', dropped ? index - 1 : index])}: clear: ${error} after another effect, which version 5 derives as the first one and refuses written: drop it by hand`,
    )
}

/** The lines left to do by hand after every screen drops the clears version 5 derives. */
function dropAreaClears(screens: ScreenDocuments): string[] {
  return [...screens].flatMap(([path, document]) => {
    const screen = plainOf(document)
    const errors = new Map(controlsOf(screen).map(({ anchor, error }) => [anchor, error]))

    return buttonRegionsOf(screen).flatMap(({ at, region }) => {
      const error = typeof region['by'] === 'string' ? errors.get(region['by']) : undefined

      return error === undefined
        ? []
        : branchesOf(region['onDone'], [...at, 'onDone']).flatMap(([where, branch]) =>
            dropFromBranch(document, fileOf(path), where, branch, error),
          )
    })
  })
}

export const fourToFive: Migration = {
  from: 4,
  note: "a button's region clears its area's error once its action succeeds: the files drop the clear the engine derives",
  run: ({ screens }) => dropAreaClears(screens),
}
