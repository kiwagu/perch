/**
 * The anchors and codes of the sources against the contract: every literal is declared
 * once; the literals are exactly the anchors of the screen files, or with `ahead` a part of
 * them (the contract runs ahead of the app on a branch: a declared anchor not rendered yet is
 * allowed, a literal the contract lacks never is); no literal is another
 * literal plus a derived suffix (that one is built with `testIdFor()`); every suffix of
 * `testIdFor()` and every code is in the vocabulary. The problems carry `file:line`.
 */

import { baseOf } from '../anchors'
import { declaredAnchors, locate } from '../check'
import {
  type Problem,
  SCREENS_DIR,
  type ScreensFile,
  sortProblems,
  VOCABULARY_FILE,
  type Vocabulary,
} from '../files'

import type { Collected } from './collect'

interface Place {
  readonly file: string
  readonly line: number
}

const at = (place: Place, message: string): Problem => ({ ...place, message })

/** The first place of each literal, and a problem at every later one. */
function firstPlaces(collected: readonly Collected[]): {
  first: Map<string, Place>
  problems: Problem[]
} {
  const first = new Map<string, Place>()
  const problems: Problem[] = []

  for (const { file, literals } of collected) {
    for (const { anchor, line } of literals) {
      const earlier = first.get(anchor)

      if (earlier === undefined) {
        first.set(anchor, { file, line })
      } else {
        problems.push(
          at(
            { file, line },
            `"${anchor}" is declared twice; the first is at ${earlier.file}:${earlier.line}`,
          ),
        )
      }
    }
  }

  return { first, problems }
}

export function compareWithContract(
  collected: readonly Collected[],
  screens: ScreensFile,
  vocabulary: Vocabulary,
  options: { readonly ahead?: boolean } = {},
): Problem[] {
  const { first, problems: duplicates } = firstPlaces(collected)
  const contract = declaredAnchors(screens)
  const declared = new Set(contract.map(({ anchor }) => anchor))
  const suffixes = Object.keys(vocabulary.suffixes)
  const codes = new Set(Object.keys(vocabulary.codes))

  const literalProblems = [...first].flatMap(([anchor, place]) => {
    const base = baseOf(anchor, suffixes)

    return [
      ...(declared.has(anchor)
        ? []
        : [at(place, `"${anchor}" is not in ${SCREENS_DIR}; add it there or rename it`)]),
      ...(base !== undefined && first.has(base)
        ? [
            at(
              place,
              `"${anchor}" is "${base}" plus the suffix "${anchor.slice(base.length + 1)}"; derive it with testIdFor()`,
            ),
          ]
        : []),
    ]
  })

  const inScreens = locate(screens)
  const unrendered = options.ahead
    ? []
    : contract
        .filter(({ anchor }) => !first.has(anchor))
        .map(({ at: path }) =>
          inScreens(path, 'declared in the contract, but no source renders it'),
        )

  const vocabularyProblems = collected.flatMap(({ file, derived, codes: used }) => [
    ...derived
      .filter(({ suffix }) => !suffixes.includes(suffix))
      .map(({ suffix, line }) =>
        at({ file, line }, `"${suffix}" is not a derived suffix of ${VOCABULARY_FILE}`),
      ),
    ...used
      .filter(({ code }) => !codes.has(code))
      .map(({ code, line }) => at({ file, line }, `"${code}" is not a code of ${VOCABULARY_FILE}`)),
  ])

  return sortProblems([
    ...collected.flatMap(({ problems }) => problems),
    ...duplicates,
    ...literalProblems,
    ...unrendered,
    ...vocabularyProblems,
  ])
}
