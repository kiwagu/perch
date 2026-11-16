/**
 * What an element's kind implies, dropped from a screen file: a select's `dataValue: true` and
 * `option`, a secret input's `visibility-button`, the `confirm-button` and `cancel-button` of a
 * dialog and of a confirmation, each by the rule the loader derives it with (`impliedByKind`).
 * Of an anchor's `derived` only those parts go, and a list left empty goes with its key. A
 * select's `dataValue` that is not `true` says something the select's kind no longer allows, so it
 * stays and is named: dropping it would change what the select carries.
 */

import { impliedByKind } from '../../derive'

import { anchorsOf, fileOf, plainOf, type ScreenDocuments } from './screens'

/** The lines left to do by hand after the kind-implied parts of every screen are dropped. */
export function dropKindParts(screens: ScreenDocuments): string[] {
  const manual: string[] = []

  for (const [path, document] of screens) {
    for (const [anchor, def] of anchorsOf(plainOf(document))) {
      const implied = impliedByKind(def)

      if (implied === undefined) {
        continue
      }

      const at = ['anchors', anchor]
      const written: unknown = def['derived']

      if (Array.isArray(written)) {
        const parts = written.flatMap((part: unknown, index): number[] =>
          typeof part === 'string' && implied.parts.includes(part) ? [index] : [],
        )

        if (parts.length > 0 && parts.length === written.length) {
          document.deleteIn([...at, 'derived'])
        } else {
          for (const index of parts.reverse()) {
            document.deleteIn([...at, 'derived', index])
          }
        }
      }

      if (implied.dataValue && def['dataValue'] === true) {
        document.deleteIn([...at, 'dataValue'])
      } else if (implied.dataValue && def['dataValue'] !== undefined) {
        manual.push(
          `${fileOf(path)}: ${anchor}: drop \`dataValue\`: a select always carries one, so it cannot be \`${JSON.stringify(def['dataValue'])}\``,
        )
      }
    }
  }

  return manual
}
