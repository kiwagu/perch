/**
 * Builds the manifest of the contract under `root` and writes it into `outDir`: the one
 * sequence behind `ui-contract manifest` and the web app's build watcher.
 */

import { loadContract } from '../check'
import type { Problem } from '../files'

import { buildManifest } from './build'
import { productInfo } from './product'
import { writeManifest } from './write'

export function emitManifest(root: string, outDir: string): Problem[] {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    return problems
  }

  return writeManifest(root, outDir, buildManifest({ ...contract, product: productInfo(root) }))
}
