/** The changes of the contract as the hand-over block: a summary line, then one line per list. */

import type { Change } from './change'
import type { DescriptionChange } from './description-changes'
import type { ContractChanges } from './diff'

/** The lists in the order of the block, each with its singular and plural noun. */
const LISTS = [
  ['screens', 'screen', 'screens'],
  ['routeAccess', 'route access line', 'route access lines'],
  ['anchors', 'anchor', 'anchors'],
  ['sources', 'list source', 'list sources'],
  ['derived', 'derived anchor', 'derived anchors'],
  ['composites', 'composite', 'composites'],
  ['codes', 'code', 'codes'],
  ['anchorCodes', 'anchor code', 'anchor codes'],
  ['anchorStates', 'anchor state', 'anchor states'],
  ['anchorRoles', 'anchor role', 'anchor roles'],
  ['errorFields', 'error field', 'error fields'],
  ['inputs', 'field holding input', 'fields holding input'],
  ['questions', 'question before a destructive action', 'questions before destructive actions'],
  ['ranks', 'ranked message', 'ranked messages'],
  ['leaving', 'leaving action', 'leaving actions'],
  ['unsavedInput', 'unsaved-input entry', 'unsaved-input entries'],
  ['actions', 'platform action', 'platform actions'],
  ['notices', 'notice', 'notices'],
  ['entities', 'entity', 'entities'],
  ['fields', 'field', 'fields'],
  ['activities', 'activity', 'activities'],
] as const

/** The non-empty lists of one change: its count and its entries, after `where` when given. */
function linesOf(
  change: Change | ContractChanges['anchors'],
  one: string,
  many: string,
  where = '',
) {
  const lists: Array<{ verb: string; entries: string[] }> = [
    { verb: 'added', entries: change.added },
    { verb: 'removed', entries: change.removed },
    ...('renamed' in change
      ? [{ verb: 'renamed', entries: change.renamed.map(({ from, to }) => `${from} -> ${to}`) }]
      : []),
  ]

  return lists
    .filter(({ entries }) => entries.length > 0)
    .map(({ verb, entries }) => ({
      summary: `${entries.length} ${entries.length === 1 ? one : many} ${verb}${where}`,
      line: `${many} ${verb}${where}: ${entries.join(', ')}`,
    }))
}

/** A description changed, by its place: its length before and after, `new` or `gone` where it has none. */
const lengthsOf = ({ place, before, after }: DescriptionChange): string =>
  `${place} ${before ?? 'new'} -> ${after ?? 'gone'}`

/** The descriptions changed as one list, when there are any. */
const descriptionsOf = (changes: readonly DescriptionChange[]) =>
  changes.length === 0
    ? []
    : [
        {
          summary: `${changes.length} ${changes.length === 1 ? 'description' : 'descriptions'} changed`,
          line: `descriptions changed: ${changes.map(lengthsOf).join(', ')}`,
        },
      ]

/**
 * Each non-empty list (`anchors renamed`), then the transitions changed in each activity, the
 * lines changed in each screen's flow, the lines changed in each platform action, the reads
 * each action of the model comes to change or stops changing, and last the descriptions
 * changed, each with its length before and after.
 */
const listsOf = (changes: ContractChanges) => [
  ...LISTS.flatMap(([key, one, many]) => linesOf(changes[key], one, many)),
  ...Object.entries(changes.activities.transitions).flatMap(([id, change]) =>
    linesOf(change, 'transition', 'transitions', ` in ${id}`),
  ),
  ...Object.entries(changes.flows).flatMap(([id, change]) =>
    linesOf(change, 'flow line', 'flow lines', ` in ${id}`),
  ),
  ...Object.entries(changes.actionLines).flatMap(([name, change]) =>
    linesOf(change, 'platform action line', 'platform action lines', ` in ${name}`),
  ),
  ...Object.entries(changes.modelActionLines).flatMap(([name, change]) =>
    linesOf(change, 'model action line', 'model action lines', ` in ${name}`),
  ),
  ...descriptionsOf(changes.descriptions),
]

/** The hand-over block: a summary line, then one line per list that is not empty. */
export function formatChanges(changes: ContractChanges): string {
  const lists = listsOf(changes)

  if (lists.length === 0) {
    return 'contract changes: none'
  }

  return [
    `contract changes: ${lists.map(({ summary }) => summary).join(', ')}`,
    ...lists.map(({ line }) => line),
  ].join('\n')
}
