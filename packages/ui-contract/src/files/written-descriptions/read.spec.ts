import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../../contract-repository.fixture'
import { ACTIVITIES_DIR, MODEL_FILE, PLATFORM_FILE } from '../paths'

import { readDescriptions } from './read'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-descriptions-'))
  writeContractRepository(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** Each description read, as `<file>:<line> <place>`. */
const listed = (): string[] =>
  readDescriptions(root).descriptions.map(({ file, line, place }) => `${file}:${line} ${place}`)

describe('readDescriptions', () => {
  it('reads every description the domain files write, each with its file and line', () => {
    expect(readDescriptions(root).problems).toEqual([])
    expect(listed()).toEqual([
      'contract/domain/screens/$.yaml:4 not-found',
      'contract/domain/screens/__root.yaml:4 app-shell',
      'contract/domain/screens/__root.yaml:12 app-shell.status',
      'contract/domain/screens/__root.yaml:16 app-shell.notice-message',
      'contract/domain/screens/sample/$key.yaml:4 sample',
      'contract/domain/screens/sample/$key.yaml:11 sample.page',
      'contract/domain/platform.yaml:5 platform action sign-out',
      'contract/domain/platform.yaml:9 platform action sign-out param forgetUnsent',
      'contract/domain/activities/thing.yaml:4 activity thing',
      'contract/domain/activities/thing.yaml:8 activity thing data thing',
      'contract/domain/activities/thing.yaml:10 activity thing data thing.title',
      'contract/domain/activities/thing.yaml:15 activity thing state editing',
      'contract/domain/activities/thing.yaml:20 activity thing state editing on sample.save-button',
      'contract/domain/activities/thing.yaml:22 activity thing state saved',
      'contract/domain/model.schema.json:7 model entity thing',
      'contract/domain/model.schema.json:16 model action thing.createThing',
      'contract/domain/model.schema.json:26 model field thing.id',
    ])
  })
  it('gives each its text as written and the kind of the field it is', () => {
    expect(readDescriptions(root).descriptions[15]).toEqual({
      file: MODEL_FILE,
      line: 16,
      at: ['$defs', 'thing', 'x-perch', 'actions', 'createThing', 'description'],
      kind: 'modelAction',
      place: 'model action thing.createThing',
      text: 'Adds a thing.',
    })
  })
  it('reads no activity where the folder is not there, which is no problem', () => {
    rmSync(join(root, ACTIVITIES_DIR), { recursive: true })

    expect(readDescriptions(root).problems).toEqual([])
    expect(listed().filter((each) => each.includes('activities/'))).toEqual([])
  })
  it('names a file that does not read as YAML', () => {
    writeFileSync(join(root, PLATFORM_FILE), 'version: [ 1\n')

    expect(readDescriptions(root).problems.map(({ file }) => file)).toEqual([PLATFORM_FILE])
  })
})
