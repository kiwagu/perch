/** The files of a folder, at any depth, for the loaders of the folders of the contract. */

import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The files under `dir` as paths relative to it with `/` separators, sorted; none when unreadable. */
export function filesUnder(dir: string): string[] | undefined {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join('/'))
      .sort()
  } catch {
    return undefined
  }
}
