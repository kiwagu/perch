/**
 * The opt-outs the sources write against the contract. The kit takes a field's opt-outs from the
 * generated field facts, so a view may leave them out, and nothing is wanted of a field rendered.
 * One a view does write is held to the contract: a `holdsInput` is `{false}`, on a field the
 * contract says holds no input, never on an anchor that is not a field; a `marksState` is
 * `{false}` too, on a field the contract says drops its state colour, never on an anchor that is
 * not an input, a textarea or a select that holds input.
 *
 * A paged list's size select is no declared anchor: the list derives it, and by its facet it is a
 * select that holds no input. `holdsInput={false}` on it is no problem, `{true}` is the default,
 * and a `marksState` sits on a select that holds no input. A flag on any other part a
 * `testIdFor()` derives is a problem: that part is no field.
 */

import { FIELD_KINDS, SIZE_SELECT, STATEFUL_FIELD_KINDS, testIdFor } from '../anchors'
import type { DeclaredAnchor } from '../check'
import type { Problem } from '../files'

import type { Collected } from './collect'

interface OptOuts {
  readonly collected: readonly Collected[]
  readonly contract: readonly DeclaredAnchor[]
}

/** What the state colour check knows of an anchor a `marksState` can sit on. */
interface Colour {
  readonly kind: string
  readonly shows: boolean
  readonly dropped: boolean
}

/** The size select each paged list of the contract derives. */
const sizeSelectsOf = (contract: readonly DeclaredAnchor[]): ReadonlySet<string> =>
  new Set(
    contract
      .filter(({ def }) => def.derived?.includes(SIZE_SELECT) === true)
      .map(({ anchor }) => testIdFor(anchor, SIZE_SELECT)),
  )

/** The base of a part is declared when an anchor of the contract carries that name. */
const isDeclared = (contract: readonly DeclaredAnchor[], base: string): boolean =>
  contract.some(({ anchor }) => anchor === base)

function holdsInputProblems({ collected, contract }: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)
  const holding = new Set(
    contract
      .filter(({ def }) => FIELD_KINDS.has(def.kind) && def.holdsInput !== false)
      .map(({ anchor }) => anchor),
  )
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

      if (holdsInput) {
        return [
          { ...place, message: `"${anchor}": holdsInput={true} is the default; leave it out` },
        ]
      }

      return holding.has(anchor)
        ? [
            {
              ...place,
              message: `"${anchor}" holds input by the contract; drop holdsInput={false}`,
            },
          ]
        : []
    }),
  )
}

function marksStateProblems({ collected, contract }: OptOuts): Problem[] {
  const sizeSelects = sizeSelectsOf(contract)

  // The state colour is shown by an input, a textarea or a select that holds input, the same test
  // as the screens check; the contract may drop it.
  const shown = new Map<string, Colour>([
    ...contract.map(({ anchor, def }): [string, Colour] => [
      anchor,
      {
        kind: def.kind,
        shows: STATEFUL_FIELD_KINDS.has(def.kind) && def.holdsInput === true,
        dropped: def.marksState === false,
      },
    ]),
    ...[...sizeSelects].map((anchor): [string, Colour] => [
      anchor,
      { kind: 'select', shows: false, dropped: false },
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
}

export const optOutProblems = (optOuts: OptOuts): Problem[] => [
  ...holdsInputProblems(optOuts),
  ...marksStateProblems(optOuts),
]
