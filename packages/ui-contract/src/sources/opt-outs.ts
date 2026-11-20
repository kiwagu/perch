/**
 * The flags the sources write against the contract. The contract decides whether a field holds
 * input (`holdsInput`) and whether it shows its state colour (`marksState`), and the kit takes
 * both from the generated field facts (by the field's anchor), so a view writes neither on a
 * declared field: no `{false}`, no `{true}`, in ahead mode too, and nothing is wanted of a field
 * rendered. A flag is also a problem on an anchor that is not a field that holds input (a
 * `holdsInput` on a page, a `marksState` on a form, a checkbox or a select that holds none), and
 * on any other part a `testIdFor()` derives: that part is no field.
 *
 * A paged list's size select is no declared anchor: the list derives it, and by its facet it is a
 * select that holds no input, which the field facts carry too. A `holdsInput` on it is refused as
 * on a declared field, a `marksState` on it as one on a select that holds no input, whichever
 * value they write.
 */

import { FIELD_KINDS, SIZE_SELECT, STATEFUL_FIELD_KINDS, testIdFor } from '../anchors'
import type { DeclaredAnchor } from '../check'
import type { Problem } from '../files'

import { type Collected, LEFT_TO_THE_KIT } from './collect'

interface OptOuts {
  readonly collected: readonly Collected[]
  readonly contract: readonly DeclaredAnchor[]
}

/** What the state colour check knows of an anchor a `marksState` can sit on. */
interface Colour {
  readonly kind: string
  readonly shows: boolean
}

/** The size select each paged list of the contract derives. */
const sizeSelectsOf = (contract: readonly DeclaredAnchor[]): Set<string> =>
  new Set(
    contract
      .filter(({ def }) => def.derived?.includes(SIZE_SELECT) === true)
      .map(({ anchor }) => testIdFor(anchor, SIZE_SELECT)),
  )

/** The base of a part is declared when an anchor of the contract carries that name. */
const isDeclared = (contract: readonly DeclaredAnchor[], base: string): boolean =>
  contract.some(({ anchor }) => anchor === base)

/** A flag a view writes on a field, which the kit takes from the contract's field facts. */
const leftToTheKit = (anchor: string, name: string, value: boolean): string =>
  `"${anchor}": ${name}={${value}}, but ${LEFT_TO_THE_KIT}`

function holdsInputProblems({ collected, contract }: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)
  const kinds = new Map<string, string>([
    ...contract.map(({ anchor, def }): [string, string] => [anchor, def.kind]),
    ...[...sizeSelects].map((anchor): [string, string] => [anchor, 'select']),
  ])

  return collected.flatMap(({ file, inputs }) =>
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

      // An anchor the contract lacks is the literals check's problem.
      return kind === undefined
        ? []
        : [{ ...place, message: leftToTheKit(anchor, 'holdsInput', holdsInput) }]
    }),
  )
}

function marksStateProblems({ collected, contract }: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)

  // The state colour is shown by an input, a textarea or a select that holds input, the same test
  // as the screens check; the size select derived by a paged list holds none.
  const shown = new Map<string, Colour>([
    ...contract.map(({ anchor, def }): [string, Colour] => [
      anchor,
      { kind: def.kind, shows: STATEFUL_FIELD_KINDS.has(def.kind) && def.holdsInput === true },
    ]),
    ...[...sizeSelects].map((anchor): [string, Colour] => [
      anchor,
      { kind: 'select', shows: false },
    ]),
  ])

  return collected.flatMap(({ file, colours }) =>
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

      // An anchor the contract lacks is the literals check's problem.
      return colour === undefined
        ? []
        : [{ ...place, message: leftToTheKit(anchor, 'marksState', marksState) }]
    }),
  )
}

export const optOutProblems = (optOuts: OptOuts): Problem[] => [
  ...holdsInputProblems(optOuts),
  ...marksStateProblems(optOuts),
]
