/**
 * The descriptions the terms file writes: the meaning of each context, term and role, by its
 * name (`context perch`, `term account`, `role operator`). A meaning is a written description: it
 * keeps the budget, and the hand-over diff lists it.
 */

import { entriesOf, recordOf } from '../../records'
import type { DescriptionKind } from '../../schemas'

import type { Found } from './found'

const SECTIONS: ReadonlyArray<readonly [string, DescriptionKind]> = [
  ['contexts', 'context'],
  ['terms', 'term'],
  ['roles', 'role'],
]

/** The meanings the terms file `value` writes, section by section, in the order of the file. */
export function termsDescriptions(value: unknown): Found[] {
  const sections = recordOf(value)

  return SECTIONS.flatMap(([section, kind]) =>
    entriesOf(sections[section]).flatMap(([name, entry]): Found[] => {
      const text = recordOf(entry)['meaning']

      return typeof text === 'string'
        ? [{ at: [section, name, 'meaning'], kind, place: `${kind} ${name}`, text }]
        : []
    }),
  )
}
