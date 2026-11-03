/**
 * The anchors whose written description is what the engine would say on its own (a heading
 * naming its screen, a link leading to its screen, a secret input, an error with its actions and
 * codes): the lines `ui-contract coverage --descriptions` prints for the owner to drop. An
 * anchor a composite derives is no line: its description is the platform's, never written.
 */

import type { Contract } from '../check'
import { declaredAnchors } from '../check'
import { derivedDescriptionOf, failuresOf } from '../files'

/** One `<anchor>: <description>` line per written description the engine says itself. */
export function listDescriptions(contract: Contract): string {
  const context = {
    screens: contract.screens.screens,
    codes: contract.vocabulary.codes,
    failureOf: failuresOf(contract.model, contract.screens.platform.actions),
  }
  const lines = declaredAnchors(contract.screens).flatMap(({ anchor, def, screen }) => {
    const derived = derivedDescriptionOf(anchor, def, screen, context)

    return def.derivedFrom === undefined &&
      def.description !== undefined &&
      def.description === derived
      ? [`${anchor}: ${def.description}`]
      : []
  })

  return lines.length === 0
    ? 'no written description the engine says itself'
    : [`${lines.length} written description(s) the engine says itself:`, ...lines].join('\n')
}
