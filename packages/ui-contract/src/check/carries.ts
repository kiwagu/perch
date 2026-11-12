/**
 * What an anchor carries: the `data-code`, `data-state` and `data-value` values a scenario's
 * bracket or a test's assertion may pair with it. An anchor carries what it declares and what
 * every anchor under it (`<anchor>.<rest>`) declares, so "every item of [list] carries
 * [state:met]" holds through the composite's items: codes from the loaded `codes` (the codes the
 * loader derives included), states from `states`, values from the choice-value rows of the
 * anchor and of its options, `show` or `hide` for a visibility-button, the values its suffix
 * defines, and the page sizes of its action for the options of a paged list's size select.
 */

import { isUnder, VISIBILITY_VALUES } from '../anchors'

import {
  type Contract,
  declaredAnchors,
  has,
  isValueOf,
  pageSizeOptionsOf,
  visibilityButtonsOf,
} from './contract'

/** What an anchor carries a value of: its `data-code`, its `data-state` or its `data-value`. */
export type Carried = 'code' | 'state' | 'value'

/**
 * Whether `anchor`, or an anchor under it, carries `value` as its `carried`: a code of its
 * `codes`, a state of its `states`, a row of its choice values (or a value its pattern row
 * matches), or `show`/`hide` on a visibility-button.
 */
export function anchorCarries(
  contract: Contract,
): (anchor: string, carried: Carried, value: string) => boolean {
  const declared = declaredAnchors(contract.screens)
  const choices = Object.entries(contract.vocabulary.choiceValues)
  const visibilityButtons = [...visibilityButtonsOf(contract.screens)]
  const sizeOptions = [...pageSizeOptionsOf(contract.screens)]
  const declares = (anchor: string, value: string, of: 'codes' | 'states'): boolean =>
    declared.some(
      ({ anchor: other, def }) => isUnder(anchor, other) && (def[of] ?? []).includes(value),
    )

  return (anchor, carried, value) => {
    switch (carried) {
      case 'code':
        return declares(anchor, value, 'codes')
      case 'state':
        return declares(anchor, value, 'states')
      case 'value':
        return (
          choices.some(([other, rows]) => isUnder(anchor, other) && isValueOf(rows, value)) ||
          (has(VISIBILITY_VALUES, value) &&
            visibilityButtons.some((button) => isUnder(anchor, button))) ||
          sizeOptions.some(([option, sizes]) => isUnder(anchor, option) && sizes.includes(value))
        )
    }
  }
}
