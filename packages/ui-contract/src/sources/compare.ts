/**
 * The anchors and codes of the sources against the contract: every literal is declared
 * once; the literals are exactly the anchors of the screen files, or with `ahead` a part of
 * them (the contract runs ahead of the app on a branch: a declared anchor not rendered yet is
 * allowed, a literal the contract lacks never is); no literal is another
 * literal plus a derived suffix (that one is built with `testIdFor()`); every code is in the
 * vocabulary, and every suffix of `testIdFor()` too, listed in the `derived` of an anchor of the
 * contract (of the base itself when the call writes it as a literal); a `holdsInput` written in
 * the sources is `{false}`, on a field the contract says holds no input, never on an anchor that
 * is not a field, and every such field rendered carries it; a `marksState` is `{false}` too, on a
 * field the contract says drops its state colour, never on an anchor that is not an input, a
 * textarea or a select that holds input, and every such field rendered carries it. The problems
 * carry `file:line`.
 */

import { baseOf, FIELD_KINDS, STATEFUL_FIELD_KINDS } from '../anchors'
import { codesOf, type DeclaredAnchor, declaredAnchors, locate } from '../check'
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

/**
 * The parts the sources derive with `testIdFor()`: each suffix is one of the vocabulary that an
 * anchor of the contract lists in `derived`, the base itself when the call writes it as a
 * literal. A part no anchor declares (a visibility-button no input lists) is never rendered.
 */
function partProblems(
  collected: readonly Collected[],
  contract: readonly DeclaredAnchor[],
  suffixes: readonly string[],
): Problem[] {
  const derivedBy = new Map(contract.map(({ anchor, def }) => [anchor, def.derived ?? []]))
  const listed = new Set(contract.flatMap(({ def }) => def.derived ?? []))
  const problemOf = (suffix: string, base: string | undefined, place: Place): Problem[] => {
    if (!suffixes.includes(suffix)) {
      return [at(place, `"${suffix}" is not a derived suffix of ${VOCABULARY_FILE}`)]
    }

    if (base === undefined) {
      return listed.has(suffix)
        ? []
        : [at(place, `"${suffix}": no anchor of ${SCREENS_DIR} lists it in its derived`)]
    }

    const call = `testIdFor("${base}", "${suffix}")`
    const derived = derivedBy.get(base)

    if (derived === undefined) {
      return [at(place, `${call}: "${base}" is not in ${SCREENS_DIR}`)]
    }

    return derived.includes(suffix)
      ? []
      : [at(place, `${call}: "${base}" does not list "${suffix}" in its derived`)]
  }

  return collected.flatMap(({ file, derived }) =>
    derived.flatMap(({ suffix, base, line }) => problemOf(suffix, base, { file, line })),
  )
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
  const codes = codesOf(vocabulary, screens)

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

  const codeProblems = collected.flatMap(({ file, codes: used }) =>
    used
      .filter(({ code }) => !codes.has(code))
      .map(({ code, line }) => at({ file, line }, `"${code}" is not a code of ${VOCABULARY_FILE}`)),
  )

  const fields = new Map(
    contract
      .filter(({ def }) => FIELD_KINDS.has(def.kind))
      .map(({ anchor, def, at: path }) => [anchor, { holds: def.holdsInput !== false, path }]),
  )
  const kinds = new Map(contract.map(({ anchor, def }) => [anchor, def.kind]))
  const inputProblems = collected.flatMap(({ file, inputs }) =>
    inputs.flatMap(({ anchor, holdsInput, line }) => {
      const kind = kinds.get(anchor)

      if (kind !== undefined && !FIELD_KINDS.has(kind)) {
        return [
          at({ file, line }, `"${anchor}" is a ${kind}, not a field; only a field holds input`),
        ]
      }

      if (holdsInput) {
        return [at({ file, line }, `"${anchor}": holdsInput={true} is the default; leave it out`)]
      }

      return fields.get(anchor)?.holds === true
        ? [at({ file, line }, `"${anchor}" holds input by the contract; drop holdsInput={false}`)]
        : []
    }),
  )

  // A field that holds no input (a choice that applies at once) says so on its element, once
  // rendered; on a branch the contract may run ahead of that element, as of an anchor not rendered.
  const optedOut = new Set(
    collected.flatMap(({ inputs }) =>
      inputs.filter(({ holdsInput }) => !holdsInput).map(({ anchor }) => anchor),
    ),
  )
  const missingOptOuts = [...fields]
    .filter(
      ([anchor, { holds }]) =>
        !options.ahead && !holds && first.has(anchor) && !optedOut.has(anchor),
    )
    .map(([, { path }]) =>
      inScreens(
        path,
        'does not hold input by the contract; its element carries holdsInput={false}',
      ),
    )

  // The state colour is shown by an input, a textarea or a select that holds input, the same test
  // as the screens check; the contract may drop it, and the element says so once it is rendered.
  const shown = new Map(
    contract.map(({ anchor, def, at: path }) => [
      anchor,
      {
        kind: def.kind,
        shows: STATEFUL_FIELD_KINDS.has(def.kind) && def.holdsInput === true,
        dropped: def.marksState === false,
        path,
      },
    ]),
  )
  const colourProblems = collected.flatMap(({ file, colours }) =>
    colours.flatMap(({ anchor, marksState, line }) => {
      const colour = shown.get(anchor)

      if (colour !== undefined && !colour.shows) {
        return [
          at(
            { file, line },
            `"${anchor}" is a ${colour.kind}, not a field that holds input; only such a field shows a state colour`,
          ),
        ]
      }

      if (marksState) {
        return [at({ file, line }, `"${anchor}": marksState={true} is the default; leave it out`)]
      }

      return colour?.dropped === false
        ? [
            at(
              { file, line },
              `"${anchor}" shows its state colour by the contract; drop marksState={false}`,
            ),
          ]
        : []
    }),
  )
  const droppedOnElement = new Set(
    collected.flatMap(({ colours }) =>
      colours.filter(({ marksState }) => !marksState).map(({ anchor }) => anchor),
    ),
  )
  const missingColourOptOuts = [...shown]
    .filter(
      ([anchor, { shows, dropped }]) =>
        !options.ahead && shows && dropped && first.has(anchor) && !droppedOnElement.has(anchor),
    )
    .map(([, { path }]) =>
      inScreens(
        path,
        'shows no state colour by the contract; its element carries marksState={false}',
      ),
    )

  return sortProblems([
    ...collected.flatMap(({ problems }) => problems),
    ...duplicates,
    ...literalProblems,
    ...unrendered,
    ...partProblems(collected, contract, suffixes),
    ...codeProblems,
    ...inputProblems,
    ...missingOptOuts,
    ...colourProblems,
    ...missingColourOptOuts,
  ])
}
