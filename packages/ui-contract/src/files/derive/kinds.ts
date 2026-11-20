/**
 * What an element's kind implies, derived from version 4: a `select` carries a `data-value` on
 * each choice (`dataValue: true`) and renders its `option`s; a secret `input` renders the eye that
 * shows or hides what it holds (`visibility-button`); a `dialog` and a `confirmation` render their
 * two answers (`confirm-button`, `cancel-button`). The loader lists each part in the anchor's
 * `derived`, after the suffixes the file writes, so every reader of `derived` and `dataValue` takes
 * it; from version 4 a screen file never writes one of them, and a part it writes is a problem.
 * Before version 4 nothing is derived and what a file writes is accepted as written. A `derived`
 * written as anything but a list stays for the schema to refuse.
 */

import { ANSWERS, OPTION, VISIBILITY_BASE_KIND, VISIBILITY_BUTTON } from '../../anchors'
import { entriesOf, isRecord } from '../../records'
import { jsonPath, type Problem } from '../problems'

/** The version from which what a kind implies is derived, and a screen file never writes it. */
const KIND_PARTS_EDITION = 4

/** What a kind implies: the derived parts of the anchor, and whether it carries a `data-value`. */
export interface Implied {
  readonly parts: readonly string[]
  readonly dataValue: boolean
}

/** What the anchor `def` implies by its kind, if it implies anything. */
export function impliedByKind(def: Readonly<Record<string, unknown>>): Implied | undefined {
  switch (def['kind']) {
    case 'select':
      return { parts: [OPTION], dataValue: true }
    case VISIBILITY_BASE_KIND:
      return def['secret'] === true ? { parts: [VISIBILITY_BUTTON], dataValue: false } : undefined
    case 'dialog':
    case 'confirmation':
      return { parts: ANSWERS, dataValue: false }
    default:
      return undefined
  }
}

/** `screen` as read, each anchor with the parts and the data value its kind implies. */
export function withDerivedKindParts(
  file: string,
  screen: unknown,
  edition: number,
): { value: unknown; problems: Problem[] } {
  const anchors = isRecord(screen) ? screen['anchors'] : undefined

  if (edition < KIND_PARTS_EDITION || !isRecord(screen) || !isRecord(anchors)) {
    return { value: screen, problems: [] }
  }

  const problems: Problem[] = []
  const problemAt = (at: readonly PropertyKey[], message: string): void => {
    problems.push({ file, message: `${jsonPath(at)}: ${message}` })
  }
  const derived = entriesOf(anchors).map(([anchor, def]): [string, unknown] => {
    const implied = isRecord(def) ? impliedByKind(def) : undefined
    const written = isRecord(def) ? (def['derived'] ?? []) : undefined

    if (!isRecord(def) || implied === undefined || !Array.isArray(written)) {
      return [anchor, def]
    }

    const suffixes: unknown[] = written.filter((suffix: unknown, index) => {
      const ours = typeof suffix === 'string' && implied.parts.includes(suffix)

      if (ours) {
        problemAt(
          ['anchors', anchor, 'derived', index],
          `"${suffix}" is derived from its kind; leave it out`,
        )
      }

      return !ours
    })

    if (implied.dataValue && def['dataValue'] !== undefined) {
      problemAt(
        ['anchors', anchor, 'dataValue'],
        'dataValue is derived from its kind; leave it out',
      )
    }

    return [
      anchor,
      {
        ...def,
        ...(implied.dataValue ? { dataValue: true } : {}),
        derived: [...suffixes, ...implied.parts],
      },
    ]
  })

  return { value: { ...screen, anchors: Object.fromEntries(derived) }, problems }
}
