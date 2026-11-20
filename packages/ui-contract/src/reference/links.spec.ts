import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeContractRepository } from '../contract-repository.fixture'
import { GUIDE_FILES, REFERENCE_FILE } from '../files'

import { referenceLinkProblems } from './links'
import { REFERENCE_RULES } from './rules'
import { referenceSlug } from './slug'

const README = 'contract/README.md'
const KEY = 'screen-anchors-name-secret'
const RULE = referenceSlug('rule', REFERENCE_RULES[0]?.id ?? '')

let root: string

const write = (file: string, text: string): void => {
  mkdirSync(dirname(join(root, file)), { recursive: true })
  writeFileSync(join(root, file), text)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-links-'))
  writeContractRepository(root)
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('referenceLinkProblems', () => {
  it('is empty when no guide links into the reference', () => {
    write(README, '# Guide\n\nSee contract/REFERENCE.md and `contract/REFERENCE.md#<slug>`.\n')

    expect(referenceLinkProblems(root)).toEqual([])
  })
  it('is empty for a link to an anchor of a key and for one to an anchor of a rule', () => {
    write(
      README,
      `# Guide\n\n[a](contract/REFERENCE.md#${KEY}) and [b](contract/REFERENCE.md#${RULE}).\n`,
    )

    expect(referenceLinkProblems(root)).toEqual([])
  })
  it('names an unknown slug at its line', () => {
    write(README, `# Guide\n\nSee [it](contract/REFERENCE.md#${KEY}-gone).\n`)

    expect(referenceLinkProblems(root)).toEqual([
      {
        file: README,
        line: 3,
        message: `links to contract/REFERENCE.md#${KEY}-gone, which is no anchor of the reference`,
      },
    ])
  })
  it('names each unknown slug of a line, and takes a relative link for a link', () => {
    write(
      README,
      `# Guide\n\n[a](REFERENCE.md#nope) [b](REFERENCE.md#${KEY}) [c](REFERENCE.md#Nope-2)\n`,
    )

    expect(referenceLinkProblems(root).map(({ line, message }) => [line, message])).toEqual([
      [3, 'links to contract/REFERENCE.md#nope, which is no anchor of the reference'],
      [3, 'links to contract/REFERENCE.md#Nope-2, which is no anchor of the reference'],
    ])
  })
  it('names a valid anchor followed by more text in a Markdown link, by its whole fragment', () => {
    write(README, `# Guide\n\nSee [it](contract/REFERENCE.md#${KEY}.typo).\n`)

    expect(referenceLinkProblems(root)).toEqual([
      {
        file: README,
        line: 3,
        message: `links to contract/REFERENCE.md#${KEY}.typo, which is no anchor of the reference`,
      },
    ])
  })
  it('names a valid anchor followed by more text between backticks, by its whole fragment', () => {
    write(README, `# Guide\n\nSee \`contract/REFERENCE.md#${KEY}.typo\` here.\n`)

    expect(referenceLinkProblems(root)).toEqual([
      {
        file: README,
        line: 3,
        message: `links to contract/REFERENCE.md#${KEY}.typo, which is no anchor of the reference`,
      },
    ])
  })
  it('ends a fragment at its closing delimiter: a parenthesis, a backtick, a bracket or a space', () => {
    write(
      README,
      `# Guide\n\n(\`contract/REFERENCE.md#${KEY}\`), \`contract/REFERENCE.md#${RULE}\`; [c](REFERENCE.md#${KEY}) [REFERENCE.md#${RULE}] REFERENCE.md#${KEY} end\n`,
    )

    expect(referenceLinkProblems(root)).toEqual([])
  })
  it.each(GUIDE_FILES)('reads %s', (file) => {
    write(file, `one\n\n[a](contract/REFERENCE.md#nope)\n`)

    expect(referenceLinkProblems(root)).toEqual([
      {
        file,
        line: 3,
        message: 'links to contract/REFERENCE.md#nope, which is no anchor of the reference',
      },
    ])
  })
  it('names every link when the reference is missing', () => {
    rmSync(join(root, REFERENCE_FILE))
    write(README, `[a](contract/REFERENCE.md#${KEY})\n`)

    expect(referenceLinkProblems(root).map(({ file, line }) => [file, line])).toEqual([[README, 1]])
  })
})
