import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkContract, keyProblems, parameterSample } from '../../check'
import { contractAt } from '../../manifest/manifest.fixture'
import { PLATFORM_FILE } from '../paths'
import { formatProblem } from '../problems'
import { loadScreens } from '../screens'

import { LANDING_FILE, writeMailLinkRepository } from './mail-links.fixture'

const roots: string[] = []

/** The sample at `version` with the landing a mail links to, its parameter `written` or left out. */
function repositoryAt(version: number, written: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-mail-links-'))

  roots.push(root)
  writeMailLinkRepository(root, version, written)

  return root
}

/** `file` of the repository `root`, its `text` changed by `change`. */
function rewrite(root: string, file: string, change: (text: string) => string): void {
  writeFileSync(join(root, file), change(readFileSync(join(root, file), 'utf8')))
}

/**
 * The version 4 sample whose token is a value that takes `a` or `b` alone, and whose landing, when
 * `tab` is true, also writes a page choice of the same two values with no control.
 */
function enumRepository(tab: boolean): string {
  const root = repositoryAt(4, false)

  rewrite(root, PLATFORM_FILE, (text) =>
    text
      .replace('    minLength: 1\n    maxLength: 4096\n', '    enum: [ a, b ]\n')
      .replace('examples: [ token-0123456789abcdef ]', 'examples: [ a ]'),
  )

  if (tab) {
    rewrite(root, LANDING_FILE, (text) =>
      text.replace(
        '    roles: [ guest, identity ]\n',
        '    roles: [ guest, identity ]\n    search:\n      type: object\n      properties:\n        tab: { type: string, enum: [ a, b ] }\n      additionalProperties: false\n',
      ),
    )
  }

  return root
}

/** The search parameters of the landing's one route, as the loader holds them. */
function searchOf(root: string) {
  const landing = loadScreens(root).screens?.screens.find(({ id }) => id === 'sample.landing')

  return landing?.bindings[0]?.search
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('a screen a mail links to, on a repository', () => {
  it('passes the check at version 3 with the parameter written, and at version 4 with it left out', () => {
    expect(checkContract(repositoryAt(3, true)).map(formatProblem)).toEqual([])
    expect(checkContract(repositoryAt(4, false)).map(formatProblem)).toEqual([])
  })
  it('loads at version 4 the parameter the version 3 file writes, with the key beside it', () => {
    const written = repositoryAt(3, true)
    const bare = repositoryAt(4, false)

    expect(readFileSync(join(bare, LANDING_FILE), 'utf8')).not.toContain('additionalProperties')
    expect(searchOf(bare)).toEqual({
      ...searchOf(written),
      properties: {
        token: { ...searchOf(written)?.properties['token'], 'x-perch': { key: 'link-invalid' } },
      },
    })
  })
  it('has a derived parameter whose examples the check samples, a key the check holds to the actions', () => {
    const contract = contractAt(repositoryAt(4, false))
    const landing = contract.screens.screens.find(({ id }) => id === 'sample.landing')
    const token = landing?.bindings[0]?.search?.properties['token']

    expect(token?.['x-perch']).toEqual({ key: 'link-invalid' })
    expect(keyProblems(contract)).toEqual([])
    expect(token === undefined ? undefined : parameterSample(token, 'search')).toBe(
      'token-0123456789abcdef',
    )
  })
  it('wants no control for the enum of a parameter a mail derives, and still one for a page choice beside it', () => {
    const contract = contractAt(enumRepository(false))
    const landing = contract.screens.screens.find(({ id }) => id === 'sample.landing')

    expect(landing?.bindings[0]?.search?.properties['token']).toMatchObject({ enum: ['a', 'b'] })
    expect(checkContract(enumRepository(false)).map(formatProblem)).toEqual([])
    expect(checkContract(enumRepository(true)).map(({ message }) => message)).toEqual([
      'bindings[0].search.properties.tab: the enum value "a" has no control under x-perch.values',
      'bindings[0].search.properties.tab: the enum value "b" has no control under x-perch.values',
    ])
  })
  it('refuses at version 4 the parameter the file still writes', () => {
    const problems = checkContract(repositoryAt(4, true)).map(formatProblem)

    expect(problems).toHaveLength(1)
    expect(problems[0]).toContain(
      'bindings[0].search.properties.token: derived from the mail link of the platform action "invite"; leave it out',
    )
  })
})
