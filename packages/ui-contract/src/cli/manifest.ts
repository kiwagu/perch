/** `ui-contract manifest [--out <dir>]`, from the root or any folder under it. */

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

import { PLATFORM_FILE } from '../files'
import { emitManifest, MANIFEST_DIR } from '../manifest'

import { reported } from './problems'

/** The nearest folder at or above `from` that holds the contract. */
function contractRoot(from: string): string | undefined {
  for (let folder = from; ; folder = dirname(folder)) {
    if (existsSync(join(folder, PLATFORM_FILE))) {
      return folder
    }

    if (dirname(folder) === folder) {
      return undefined
    }
  }
}

export function manifest(argv: readonly string[]): number {
  const at = argv.indexOf('--out')
  const out = resolve(at === -1 ? MANIFEST_DIR : (argv[at + 1] ?? ''))
  const root = contractRoot(process.cwd())

  if (root === undefined) {
    console.error(`ui-contract: no ${PLATFORM_FILE} here or in a folder above`)

    return 1
  }

  if (reported(emitManifest(root, out))) {
    return 1
  }

  console.log(`ui-contract: wrote ${join(out, 'manifest.json')}`)

  return 0
}
