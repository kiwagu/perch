import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { formatProblem, MANIFEST_SCHEMA_FILE, MODEL_FILE } from '../files'

import { buildManifest } from './build'
import { contractAt, REPOSITORY_ROOT } from './manifest.fixture'
import { writeManifest } from './write'

const manifest = buildManifest({
  ...contractAt(REPOSITORY_ROOT),
  product: { name: 'perch', version: '0.1.0', commit: null },
})

let temp: string
let out: string

const read = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

/** One entry of `ids` on its line: `    "<anchor>": {"kind":"...","screen":"...",...},`. */
const ID_LINE = /^ {4}"[a-z0-9.-]+": \{"kind":"[a-z-]+","screen":"[a-z.-]+".*\},?$/

beforeEach(() => {
  temp = mkdtempSync(join(tmpdir(), 'ui-contract-write-'))
  out = join(temp, 'ui-manifest')
})

afterEach(() => {
  rmSync(temp, { recursive: true, force: true })
})

describe('writeManifest', () => {
  it('writes nothing and returns the problems of a manifest that breaks its schema', () => {
    const { product: _product, ...withoutProduct } = manifest
    const broken = withoutProduct as unknown as typeof manifest

    const problems = writeManifest(REPOSITORY_ROOT, out, broken).map(formatProblem)

    expect(problems).toEqual([
      "ui-manifest/manifest.json:1: /: must have required property 'product'",
    ])
    expect(existsSync(out)).toBe(false)
  })
  it('replaces the folder with the manifest and the two schemas beside it', () => {
    mkdirSync(out)
    writeFileSync(join(out, 'stale.json'), '{}')

    expect(writeManifest(REPOSITORY_ROOT, out, manifest)).toEqual([])
    expect(readdirSync(out).sort()).toEqual([
      'manifest.json',
      'manifest.schema.json',
      'model.schema.json',
    ])
    expect(read(join(out, 'manifest.json'))).toEqual(manifest)
    expect(read(join(out, 'manifest.schema.json'))).toEqual(
      read(join(REPOSITORY_ROOT, MANIFEST_SCHEMA_FILE)),
    )
    expect(read(join(out, 'model.schema.json'))).toEqual(read(join(REPOSITORY_ROOT, MODEL_FILE)))
  })
  it('writes each entry of ids on one line, and the rest of the document two spaces deep', () => {
    expect(writeManifest(REPOSITORY_ROOT, out, manifest)).toEqual([])

    const text = readFileSync(join(out, 'manifest.json'), 'utf8')
    const lines = text.split('\n')
    const start = lines.indexOf('  "ids": {')
    const entries = lines.slice(start + 1, lines.indexOf('  },', start))
    const [first] = Object.entries(manifest.ids)

    expect(JSON.parse(text)).toEqual(manifest)
    expect(entries).toHaveLength(Object.keys(manifest.ids).length)
    expect(entries.filter((line) => !ID_LINE.test(line))).toEqual([])
    expect(entries[0]).toBe(`    ${JSON.stringify(first?.[0])}: ${JSON.stringify(first?.[1])},`)
    expect(lines.slice(0, 3)).toEqual([
      '{',
      '  "$schema": "./manifest.schema.json",',
      '  "manifestVersion": 1,',
    ])
  })
  it('refuses a folder that is not named ui-manifest, and leaves it alone', () => {
    const elsewhere = join(temp, 'dist')

    mkdirSync(elsewhere)
    writeFileSync(join(elsewhere, 'index.html'), '<!doctype html>')

    expect(writeManifest(REPOSITORY_ROOT, elsewhere, manifest).map(formatProblem)).toEqual([
      `${elsewhere}:1: the manifest goes into a folder named ui-manifest`,
    ])
    expect(readdirSync(elsewhere)).toEqual(['index.html'])
  })
})
