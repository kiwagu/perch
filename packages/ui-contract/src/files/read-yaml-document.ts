/**
 * YAML as a `Document` of the `yaml` package, for a tool that edits a contract file and writes it
 * back into its text (`writeYamlDocument`): comments, blank lines, the style of every scalar and
 * collection and the range of every node in the text are kept.
 */

import { type Document, parseDocument } from 'yaml'

/** The document of `text`, comments kept; a text that is not YAML throws its first error. */
export function parseYamlDocument(text: string): Document {
  const document = parseDocument(text)
  const [error] = document.errors

  if (error !== undefined) {
    throw error
  }

  return document
}
