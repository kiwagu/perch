/** Where a command run from any folder of the repository finds the contract. */

import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { PLATFORM_FILE } from '../files'

/** The nearest folder at or above `from` that holds the contract. */
export function contractRoot(from: string): string | undefined {
  for (let folder = from; ; folder = dirname(folder)) {
    if (existsSync(join(folder, PLATFORM_FILE))) {
      return folder
    }

    if (dirname(folder) === folder) {
      return undefined
    }
  }
}
