/**
 * Writes an edited YAML document back into the text it was parsed from. Every node the edit left
 * as it was keeps its bytes, spacing, quotes and comments included; only what changed is written,
 * by the smallest unit that holds it (`node.ts`, `block.ts`): a scalar's value in place, a pair or
 * an item of a block collection by its lines (added, removed, or written anew when its shape
 * changed), a flow collection whose parts changed as a whole, and the whole text when its root
 * changed shape. A comment is written with a node written anew, never on its own: one changed on a
 * kept node is lost. The text is read back and must hold what the document holds, else this throws.
 */

import { isDeepStrictEqual } from 'node:util'

import type { Document } from 'yaml'

import { parseYamlDocument } from '../read-yaml-document'

import type { Edit } from './edit'
import { nodeEdits } from './node'

function applied(source: string, edits: readonly Edit[]): string {
  let at = 0
  let text = ''

  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    if (edit.start < at) {
      throw new Error('two edits write one place of the text')
    }

    text += `${source.slice(at, edit.start)}${edit.text}`
    at = edit.end
  }

  return `${text}${source.slice(at)}`
}

/**
 * The text of `document`, read from `source` and edited since, with only what changed written
 * into `source`: `source` itself when nothing changed.
 */
export function writeYamlDocument(source: string, document: Document): string {
  const edits = nodeEdits(source, parseYamlDocument(source).contents, document.contents, false)

  if (edits !== undefined && edits.length === 0) {
    return source
  }

  const text = edits === undefined ? document.toString({ lineWidth: 0 }) : applied(source, edits)

  if (!isDeepStrictEqual(parseYamlDocument(text).toJS(), document.toJS())) {
    throw new Error('the edited document cannot be written into its text')
  }

  return text
}
