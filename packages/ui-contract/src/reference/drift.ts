/**
 * Whether the committed reference is what the engine renders: a schema's describe text or a rule
 * that changed and left `contract/REFERENCE.md` behind fails the contract check.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Problem, REFERENCE_FILE } from '../files'

import { renderReference } from './render'

const REWRITE = 'run `bun run contract:schemas`'

/** Nothing when the reference under `root` is what `renderReference` writes; else one problem. */
export function referenceDrift(root: string): Problem[] {
  const path = join(root, REFERENCE_FILE)

  if (!existsSync(path)) {
    return [{ file: REFERENCE_FILE, message: `is missing; ${REWRITE}` }]
  }

  return readFileSync(path, 'utf8') === renderReference()
    ? []
    : [{ file: REFERENCE_FILE, message: `differs from the engine's schemas; ${REWRITE}` }]
}
