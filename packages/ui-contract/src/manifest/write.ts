/**
 * Writes a manifest into its folder: checked first against `contract/manifest.schema.json`
 * (a manifest that breaks it writes nothing), then the folder is emptied and receives
 * `manifest.json` with the manifest's schema and the model's schema beside it.
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { MANIFEST_SCHEMA_FILE, MODEL_FILE, type Problem, validateAgainst } from '../files'
import { readJson } from '../files/read-json'

import type { Manifest } from './manifest.types'

/** The name of the folder a manifest goes into, wherever it sits. */
export const MANIFEST_DIR = 'ui-manifest'

const MANIFEST_FILE = `${MANIFEST_DIR}/manifest.json`

function manifestProblems(root: string, manifest: Manifest): Problem[] {
  const schema = readJson(root, MANIFEST_SCHEMA_FILE)

  if (schema.json === undefined) {
    return schema.problems
  }

  if (typeof schema.json !== 'object' || schema.json === null) {
    return [{ file: MANIFEST_SCHEMA_FILE, message: 'a JSON Schema is an object' }]
  }

  return validateAgainst(MANIFEST_FILE, schema.json, manifest)
}

/** `outDir` is relative to `root` unless absolute; its last segment is `ui-manifest`. */
export function writeManifest(root: string, outDir: string, manifest: Manifest): Problem[] {
  const target = resolve(root, outDir)

  if (basename(target) !== MANIFEST_DIR) {
    return [{ file: outDir, message: `the manifest goes into a folder named ${MANIFEST_DIR}` }]
  }

  const problems = manifestProblems(root, manifest)

  if (problems.length > 0) {
    return problems
  }

  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  copyFileSync(join(root, MANIFEST_SCHEMA_FILE), join(target, 'manifest.schema.json'))
  copyFileSync(join(root, MODEL_FILE), join(target, 'model.schema.json'))

  return []
}
