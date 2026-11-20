/** The screen documents a step is run over, from their texts, and the texts they write. */

import { parseYamlDocument } from '../read-yaml-document'
import { writeYamlDocument } from '../write-yaml-document'

import type { ScreenDocuments } from './screens'

/** The documents of the texts, by their paths under the screens folder. */
export const screensOf = (texts: Readonly<Record<string, string>>): ScreenDocuments =>
  new Map(Object.entries(texts).map(([path, text]) => [path, parseYamlDocument(text)]))

/** The text each document writes into the text it was read from, by its path. */
export const writtenBy = (
  texts: Readonly<Record<string, string>>,
  screens: ScreenDocuments,
): Record<string, string> =>
  Object.fromEntries(
    [...screens].map(([path, document]) => [path, writeYamlDocument(texts[path] ?? '', document)]),
  )
