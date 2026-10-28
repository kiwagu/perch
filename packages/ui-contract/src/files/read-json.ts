/** Reads a JSON contract file; a missing file or broken JSON is the one problem. */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Problem } from './problems'

export function readJson(root: string, file: string): { json?: unknown; problems: Problem[] } {
  let text: string

  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch {
    return { problems: [{ file, message: 'cannot read the file' }] }
  }

  try {
    return { json: JSON.parse(text) as unknown, problems: [] }
  } catch (error) {
    return {
      problems: [
        { file, message: `not JSON: ${error instanceof Error ? error.message : String(error)}` },
      ],
    }
  }
}
