/**
 * The opt-outs the sources write against the contract. A `holdsInput` is `{false}`, on a field
 * the contract says holds no input, never on an anchor that is not a field, and every such field
 * rendered carries it; a `marksState` is `{false}` too, on a field the contract says drops its
 * state colour, never on an anchor that is not an input, a textarea or a select that holds input,
 * and every such field rendered carries it.
 *
 * A paged list's size select is no declared anchor: the list derives it, and by its facet it is a
 * select that holds no input. `holdsInput={false}` on it is no problem, `{true}` is the default,
 * and a `marksState` sits on a select that holds no input. The prop is not asked for: the check
 * for a missing opt-out reads the literal renders, which a derived part is not. A flag on any
 * other part a `testIdFor()` derives is a problem: that part is no field.
 */

import { FIELD_KINDS, SIZE_SELECT, STATEFUL_FIELD_KINDS, testIdFor } from '../anchors'
import type { DeclaredAnchor, InScreens } from '../check'
import type { Problem } from '../files'

import type { Collected } from './collect'

interface OptOuts {
  readonly collected: readonly Collected[]
  readonly contract: readonly DeclaredAnchor[]
  readonly inScreens: InScreens
  /** The anchors a source renders as a literal. */
  readonly rendered: ReadonlySet<string>
  /** The contract runs ahead of the app: a field not carrying its opt-out yet is allowed. */
  readonly ahead: boolean
}

/** What the state colour check knows of an anchor a `marksState` can sit on. */
interface Colour {
  readonly kind: string
  readonly shows: boolean
  readonly dropped: boolean
  readonly path: readonly PropertyKey[]
}

/** The size select each paged list of the contract derives, with where its list is declared. */
const sizeSelectsOf = (
  contract: readonly DeclaredAnchor[],
): Map<string, { readonly path: readonly PropertyKey[] }> =>
  new Map(
    contract
      .filter(({ def }) => def.derived?.includes(SIZE_SELECT) === true)
      .map(({ anchor, at: path }) => [testIdFor(anchor, SIZE_SELECT), { path }]),
  )

/** The base of a part is declared when an anchor of the contract carries that name. */
const isDeclared = (contract: readonly DeclaredAnchor[], base: string): boolean =>
  contract.some(({ anchor }) => anchor === base)

function holdsInputProblems({
  collected,
  contract,
  inScreens,
  rendered,
  ahead,
}: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)
  const fields = new Map(
    contract
      .filter(({ def }) => FIELD_KINDS.has(def.kind))
      .map(({ anchor, def, at: path }) => [anchor, { holds: def.holdsInput !== false, path }]),
  )
  const kinds = new Map<string, string>([
    ...contract.map(({ anchor, def }): [string, string] => [anchor, def.kind]),
    ...[...sizeSelects.keys()].map((anchor): [string, string] => [anchor, 'select']),
  ])
  const written = collected.flatMap(({ file, inputs }) =>
    inputs.flatMap(({ anchor, base, holdsInput, line }) => {
      const kind = kinds.get(anchor)
      const place = { file, line }

      // An undeclared base is the parts check's problem: no opt-out problem on top of it.
      if (base !== undefined && !isDeclared(contract, base)) {
        return []
      }

      if (base !== undefined && !sizeSelects.has(anchor)) {
        return [
          {
            ...place,
            message: `"${anchor}" is derived from "${base}", not a field; only a field holds input`,
          },
        ]
      }

      if (kind !== undefined && !FIELD_KINDS.has(kind)) {
        return [
          { ...place, message: `"${anchor}" is a ${kind}, not a field; only a field holds input` },
        ]
      }

      if (holdsInput) {
        return [
          { ...place, message: `"${anchor}": holdsInput={true} is the default; leave it out` },
        ]
      }

      return fields.get(anchor)?.holds === true
        ? [
            {
              ...place,
              message: `"${anchor}" holds input by the contract; drop holdsInput={false}`,
            },
          ]
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
  const missing = [...fields]
    .filter(
      ([anchor, { holds }]) => !ahead && !holds && rendered.has(anchor) && !optedOut.has(anchor),
    )
    .map(([, { path }]) =>
      inScreens(
        path,
        'does not hold input by the contract; its element carries holdsInput={false}',
      ),
    )

  return [...written, ...missing]
}

function marksStateProblems({
  collected,
  contract,
  inScreens,
  rendered,
  ahead,
}: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)

  // The state colour is shown by an input, a textarea or a select that holds input, the same test
  // as the screens check; the contract may drop it, and the element says so once it is rendered.
  const shown = new Map<string, Colour>([
    ...contract.map(({ anchor, def, at: path }): [string, Colour] => [
      anchor,
      {
        kind: def.kind,
        shows: STATEFUL_FIELD_KINDS.has(def.kind) && def.holdsInput === true,
        dropped: def.marksState === false,
        path,
      },
    ]),
    ...[...sizeSelects].map(([anchor, { path }]): [string, Colour] => [
      anchor,
      { kind: 'select', shows: false, dropped: false, path },
    ]),
  ])
  const written = collected.flatMap(({ file, colours }) =>
    colours.flatMap(({ anchor, base, marksState, line }) => {
      const colour = shown.get(anchor)
      const place = { file, line }

      // An undeclared base is the parts check's problem: no opt-out problem on top of it.
      if (base !== undefined && !isDeclared(contract, base)) {
        return []
      }

      if (base !== undefined && !sizeSelects.has(anchor)) {
        return [
          {
            ...place,
            message: `"${anchor}" is derived from "${base}", not a field that holds input; only such a field shows a state colour`,
          },
        ]
      }

      if (colour !== undefined && !colour.shows) {
        return [
          {
            ...place,
            message: `"${anchor}" is a ${colour.kind}, not a field that holds input; only such a field shows a state colour`,
          },
        ]
      }

      if (marksState) {
        return [
          { ...place, message: `"${anchor}": marksState={true} is the default; leave it out` },
        ]
      }

      return colour?.dropped === false
        ? [
            {
              ...place,
              message: `"${anchor}" shows its state colour by the contract; drop marksState={false}`,
            },
          ]
        : []
    }),
  )
  const droppedOnElement = new Set(
    collected.flatMap(({ colours }) =>
      colours.filter(({ marksState }) => !marksState).map(({ anchor }) => anchor),
    ),
  )
  const missing = [...shown]
    .filter(
      ([anchor, { shows, dropped }]) =>
        !ahead && shows && dropped && rendered.has(anchor) && !droppedOnElement.has(anchor),
    )
    .map(([, { path }]) =>
      inScreens(
        path,
        'shows no state colour by the contract; its element carries marksState={false}',
      ),
    )

  return [...written, ...missing]
}

export const optOutProblems = (optOuts: OptOuts): Problem[] => [
  ...holdsInputProblems(optOuts),
  ...marksStateProblems(optOuts),
]
