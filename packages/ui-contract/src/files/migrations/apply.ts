/**
 * Moves a contract to the version this engine reads: reads the platform file and the screen files
 * as YAML documents with their comments (`parseYamlDocument`) and the vocabulary as text, runs
 * each migration from the version `platform.yaml` declares up to the engine's, setting `version`
 * after each step, and, with `write`, writes back every file a step changed. A document is written
 * into the text it was read from (`writeYamlDocument`): only the nodes the steps edited change, and
 * every other byte stays as written. Nothing is written when a step fails. Neither the check nor
 * the loader ever migrates: this runs on its command alone.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Document } from 'yaml'

import { CONTRACT_VERSION } from '../../anchors'
import { filesUnder } from '../files-under'
import { PLATFORM_FILE, SCREENS_DIR, VOCABULARY_FILE } from '../paths'
import { parseYamlDocument } from '../read-yaml-document'
import { writeYamlDocument } from '../write-yaml-document'

import type { Migration, MigrationFiles } from './migration'
import { MIGRATIONS } from './registry'

export interface MigrationStep {
  /** The version the step read; it wrote the next one. */
  readonly from: number
  readonly note: string
  /** The files the step changed, by their paths from the root, sorted. */
  readonly files: readonly string[]
  /** What the step left to do by hand. */
  readonly manual: readonly string[]
}

export interface MigrationReport {
  /** The version the contract declared. */
  readonly from: number
  /** The version it is at after the steps. */
  readonly to: number
  readonly steps: ReadonlyArray<MigrationStep>
}

const SUFFIX = '.yaml'

/** The files as read, and the text of each, by its path from the root. */
interface Read {
  readonly files: MigrationFiles
  readonly sources: ReadonlyMap<string, string>
}

/** The document of a YAML text; one that is not YAML throws, naming its file. */
function documentOf(file: string, text: string): Document {
  try {
    return parseYamlDocument(text)
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).split('\n', 1)[0] ?? ''

    throw new Error(`${file}: not YAML: ${reason.replace(/:$/, '')}`)
  }
}

function readFiles(root: string): Read {
  const paths = (filesUnder(join(root, SCREENS_DIR)) ?? []).filter((path) => path.endsWith(SUFFIX))
  const sources = new Map(
    [PLATFORM_FILE, VOCABULARY_FILE, ...paths.map((path) => `${SCREENS_DIR}/${path}`)].map(
      (file) => [file, readFileSync(join(root, file), 'utf8')] as const,
    ),
  )
  const documentAt = (file: string): Document => documentOf(file, sources.get(file) ?? '')

  return {
    files: {
      platform: documentAt(PLATFORM_FILE),
      screens: new Map(paths.map((path) => [path, documentAt(`${SCREENS_DIR}/${path}`)])),
      vocabulary: sources.get(VOCABULARY_FILE) ?? '',
    },
    sources,
  }
}

/** The text of every file as it would be written now, by its path from the root. */
function textsOf({ files, sources }: Read): Map<string, string> {
  const written = (file: string, document: Document): readonly [string, string] => [
    file,
    writeYamlDocument(sources.get(file) ?? '', document),
  ]

  return new Map([
    written(PLATFORM_FILE, files.platform),
    [VOCABULARY_FILE, files.vocabulary],
    ...[...files.screens].map(([path, document]) => written(`${SCREENS_DIR}/${path}`, document)),
  ])
}

/** The files whose text differs between two moments, sorted. */
const changedBetween = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>) =>
  [...after]
    .filter(([file, text]) => before.get(file) !== text)
    .map(([file]) => file)
    .sort()

function declaredVersion(platform: Document): number {
  const version: unknown = platform.get('version')

  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new Error(`${PLATFORM_FILE} declares no version`)
  }

  return version
}

/**
 * Runs the steps from the declared version up to `current` (the engine's, by default), each the
 * migration of `migrations` that reads its version (the engine's registry, by default), and with
 * `write` writes the files they changed. A contract newer than `current`, or a version no
 * migration reads, throws.
 */
export function migrate(
  root: string,
  options: { write: boolean; migrations?: readonly Migration[]; current?: number },
): MigrationReport {
  const { write, migrations = MIGRATIONS, current = CONTRACT_VERSION } = options
  const read = readFiles(root)
  const { files, sources } = read
  const from = declaredVersion(files.platform)

  if (from > current) {
    throw new Error(
      `the contract is at version ${from}, newer than this engine, which reads up to version ${current}`,
    )
  }

  const changed = new Set<string>()
  const steps: MigrationStep[] = []

  for (let version = from; version < current; version += 1) {
    const migration = migrations.find((each) => each.from === version)

    if (migration === undefined) {
      throw new Error(`no migration from version ${version} to ${version + 1}`)
    }

    const before = textsOf(read)
    const manual = migration.run(files)

    files.platform.set('version', version + 1)

    const touched = changedBetween(before, textsOf(read))

    for (const file of touched) {
      changed.add(file)
    }

    steps.push({ from: version, note: migration.note, files: touched, manual })
  }

  if (write) {
    for (const [file, text] of textsOf(read)) {
      if (changed.has(file) && text !== sources.get(file)) {
        writeFileSync(join(root, file), text)
      }
    }
  }

  return { from, to: current, steps }
}
