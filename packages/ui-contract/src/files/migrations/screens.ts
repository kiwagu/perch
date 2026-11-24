/** The screen documents a step of a migration edits, and what its parts read of one. */

import type { Document } from 'yaml'

import { entriesOf, isRecord, recordOf } from '../../records'
import { SCREENS_DIR } from '../paths'

/** A map read from a document as plain data. */
export type Plain = Readonly<Record<string, unknown>>

/** The screen documents of a contract, by their paths under the screens folder. */
export type ScreenDocuments = ReadonlyMap<string, Document>

/** The file of the screen document at `path`, by its path from the root, as a step names it. */
export const fileOf = (path: string): string => `${SCREENS_DIR}/${path}`

/** The document as plain data: what a part reads before it edits. */
export const plainOf = (document: Document): Plain => recordOf(document.toJS())

/** The anchors of a screen as plain data, by name; one that is no map is left out. */
export const anchorsOf = (screen: Plain): Array<[string, Plain]> =>
  entriesOf(screen['anchors']).flatMap(
    ([name, def]): Array<[string, Plain]> => (isRecord(def) ? [[name, def]] : []),
  )
