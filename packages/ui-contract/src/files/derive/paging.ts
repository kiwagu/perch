/**
 * The parts of a paged list: an anchor whose platform source says `paged: true` derives
 * `range`, `previous-link`, `next-link` and `size-select` (`PAGING_PARTS`), listed in its
 * `derived` after the suffixes it writes, so every reader of `derived` (the manifest's `ids`, the
 * known anchors, the hand-over diff) takes them. A screen file never writes one of them: the
 * loader says them, as it says a dialog's answers. A `derived` written as anything but a list
 * stays for the schema to refuse.
 */

import { PAGING_PARTS } from '../../anchors'
import { entriesOf, isRecord } from '../../records'
import { jsonPath, type Problem } from '../problems'

/** `screen` as read, each paged list's `derived` with the parts of its paging. */
export function withDerivedPaging(
  file: string,
  screen: unknown,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (!isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, problems: [] }
  }

  const problems: Problem[] = []
  const derived = entriesOf(anchors).map(([anchor, def]): [string, unknown] => {
    const source = isRecord(def) ? def['source'] : undefined
    const written = isRecord(def) ? (def['derived'] ?? []) : undefined

    if (
      !isRecord(def) ||
      !isRecord(source) ||
      source['paged'] !== true ||
      !Array.isArray(written)
    ) {
      return [anchor, def]
    }

    const suffixes: unknown[] = written.filter((suffix: unknown) => {
      const ours = typeof suffix === 'string' && PAGING_PARTS.includes(suffix)

      if (ours) {
        problems.push({
          file,
          message: `${jsonPath(['anchors', anchor, 'derived', written.indexOf(suffix)])}: "${suffix}" is derived by the paged source of the list: a screen file never writes it`,
        })
      }

      return !ours
    })

    return [anchor, { ...def, derived: [...suffixes, ...PAGING_PARTS] }]
  })

  return { value: { ...screen, anchors: Object.fromEntries(derived) }, problems }
}
