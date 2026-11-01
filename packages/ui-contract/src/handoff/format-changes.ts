/** The changes of the contract as the hand-over block: a summary line, then one line per list. */

import type { Change, ContractChanges } from './diff'

/** The lists in the order of the block, each with its singular and plural noun. */
const LISTS = [
  ['screens', 'screen', 'screens'],
  ['anchors', 'anchor', 'anchors'],
  ['derived', 'derived anchor', 'derived anchors'],
  ['codes', 'code', 'codes'],
  ['anchorCodes', 'anchor code', 'anchor codes'],
  ['errorFields', 'error field', 'error fields'],
  ['inputs', 'field holding input', 'fields holding input'],
  ['questions', 'question before a destructive action', 'questions before destructive actions'],
  ['leaving', 'leaving action', 'leaving actions'],
  ['unsavedInput', 'unsaved-input entry', 'unsaved-input entries'],
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

/** Each non-empty list (`anchors renamed`), then the transitions changed in each activity. */
const listsOf = (changes: ContractChanges) => [
  ...LISTS.flatMap(([key, one, many]) => linesOf(changes[key], one, many)),
  ...Object.entries(changes.activities.transitions).flatMap(([id, change]) =>
    linesOf(change, 'transition', 'transitions', ` in ${id}`),
  ),
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
