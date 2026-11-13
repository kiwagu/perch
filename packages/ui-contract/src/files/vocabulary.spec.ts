import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseVocabulary } from './vocabulary'

const fixture = readFileSync(join(import.meta.dirname, '../__fixtures__/vocabulary.md'), 'utf8')

const lineOf = (markdown: string, text: string): number =>
  markdown.slice(0, markdown.indexOf(text)).split('\n').length

describe('parseVocabulary', () => {
  const { vocabulary, problems } = parseVocabulary(fixture)

  it('reads the fixture without problems', () => {
    expect(problems).toEqual([])
  })
  it('reads the contract version', () => {
    expect(vocabulary.version).toBe(1)
  })
  it('reads the kinds', () => {
    expect(vocabulary.kinds).toEqual({
      button: 'a control that performs an action',
      input: 'a single-line field',
      page: 'the root of a screen',
      status: 'the readiness line of a page',
    })
  })
  it('reads the derived suffixes', () => {
    expect(vocabulary.suffixes).toEqual({
      'confirm-button': 'the primary action of a dialog',
      option: 'one entry of a select',
    })
  })
  it('reads the attributes with what they sit on', () => {
    expect(vocabulary.attributes).toEqual({
      'data-testid': { on: 'the element', meaning: 'the anchor' },
      'data-state': { on: 'a `status`', meaning: 'an app state' },
    })
  })
  it('reads the app, container and row states', () => {
    expect(vocabulary.appStates).toEqual({ ready: 'the screen is rendered' })
    expect(vocabulary.containerStates).toEqual({ loading: 'the data is being read' })
    expect(vocabulary.rowStates).toEqual({
      current: { where: '`sample.list.row-item`', meaning: 'this device' },
    })
  })
  it('reads the codes with where they appear', () => {
    expect(vocabulary.codes).toEqual({
      saved: { where: '`sample.notice-message`', meaning: 'the thing was saved' },
      failed: { where: '`sample.error`', meaning: 'any other failure' },
    })
  })
  it('groups the choice values by anchor', () => {
    expect(vocabulary.choiceValues).toEqual({
      'sample.mode-select.option': { light: 'a light page', dark: 'a dark page' },
      'sample.size-badge': { small: 'a small thing' },
    })
  })
  it('reads the screen names in use', () => {
    expect(vocabulary.screenNames).toEqual({ sample: 'the sample screen (`/sample`)' })
  })
  it('reads the roles', () => {
    expect(vocabulary.roles).toEqual({
      guest: 'nobody signed in',
      member: 'a member of the organisation',
    })
  })
  it('reads the reserved anchors', () => {
    expect(vocabulary.reserved).toEqual({ 'sample.status': 'the readiness line' })
  })
  it('reads the composites', () => {
    expect(vocabulary.composites).toEqual({ 'password-rules': 'the rules a new password keeps' })
  })
  it('reports a missing section', () => {
    const markdown = fixture.replace(/## Row states\n[\s\S]*?(?=## Codes)/, '')

    expect(parseVocabulary(markdown).problems.map((problem) => problem.message)).toEqual([
      'missing section "Row states"',
    ])
  })
  it('reads a vocabulary written before the composites as one without composites', () => {
    const older = parseVocabulary(fixture.replace(/\n## Composites\n[\s\S]*$/, ''))

    expect(older.problems).toEqual([])
    expect(older.vocabulary.composites).toEqual({})
  })
  it('reads the field states, and a vocabulary without the section reads none', () => {
    const states = parseVocabulary(
      `${fixture}\n## Field states\n\n| State | Meaning |\n|---|---|\n| \`unsaved\` | the field holds input not yet saved |\n| \`saved\` | the field holds what was saved |\n`,
    )

    expect(states.problems).toEqual([])
    expect(Object.keys(states.vocabulary.fieldStates)).toEqual(['unsaved', 'saved'])
    expect(vocabulary.fieldStates).toEqual({})
    expect(problems).toEqual([])
  })
  it('wants a state and a meaning in a field states row', () => {
    const markdown = `${fixture}\n## Field states\n\n| State | Meaning |\n|---|---|\n| \`unsaved\` | |\n| \`saved\` |\n`

    expect(parseVocabulary(markdown).problems.map((problem) => problem.message)).toEqual([
      'section "Field states": the "Meaning" cell is empty',
      'section "Field states": a row has 1 cell(s), expected 2',
    ])
  })
  it('reports an unknown section by line', () => {
    const markdown = `${fixture}\n## Extra\n\nMore text.\n`

    expect(parseVocabulary(markdown).problems).toEqual([
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '## Extra'),
        message: 'unknown section "Extra"',
      },
    ])
  })
  it('reports a section that appears twice by line', () => {
    const markdown = `${fixture}\n## Roles\n\n| Role | Meaning |\n|---|---|\n| \`admin\` | an administrator |\n`

    expect(parseVocabulary(markdown)).toMatchObject({
      vocabulary: { roles: { guest: 'nobody signed in', member: 'a member of the organisation' } },
      problems: [
        {
          file: 'contract/vocabulary.md',
          line: markdown.split('\n').lastIndexOf('## Roles') + 1,
          message: 'section "Roles" appears twice',
        },
      ],
    })
  })
  it('reports a row with the wrong number of cells by line', () => {
    const markdown = fixture.replace('| `ready` | the screen is rendered |', '| `ready` |')

    expect(parseVocabulary(markdown).problems).toEqual([
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `ready` |'),
        message: 'section "App states": a row has 1 cell(s), expected 2',
      },
    ])
  })
  it('reports a repeated key by line', () => {
    const markdown = fixture.replace('| `guest` | nobody signed in |', '| `member` | twice |')

    expect(parseVocabulary(markdown).problems).toEqual([
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `member` | a member'),
        message: 'section "Roles": "member" is listed twice',
      },
    ])
  })
  it('reports a missing contract version', () => {
    const result = parseVocabulary(fixture.replace('Contract version: 1\n', ''))

    expect(result.vocabulary.version).toBeUndefined()
    expect(result.problems.map((problem) => problem.message)).toEqual([
      'no "Contract version: N" line',
    ])
  })
  it('reports an empty mandatory cell by line, and leaves the Playwright cell optional', () => {
    const markdown = fixture
      .replace('| `ready` | the screen is rendered |', '| `ready` |  |')
      .replace('| `data-state` | a `status` | an app state |', '| `data-state` |  | an app state |')
      .replace('| `saved` | `sample.notice-message` |', '| `saved` | |')
      .replace(
        '| `sample.size-badge` | `small` | a small thing |',
        '| `sample.size-badge` | `small` | |',
      )
      .replace('| `guest` | nobody signed in |', '| | nobody signed in |')

    expect(parseVocabulary(markdown).problems).toEqual([
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `data-state` |'),
        message: 'section "Attributes": the "On" cell is empty',
      },
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `ready` |'),
        message: 'section "App states": the "Meaning" cell is empty',
      },
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `saved` |'),
        message: 'section "Codes": the "Where" cell is empty',
      },
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| `sample.size-badge` |'),
        message: 'section "Choice values": the "Meaning" cell is empty',
      },
      {
        file: 'contract/vocabulary.md',
        line: lineOf(markdown, '| | nobody signed in |'),
        message: 'section "Roles": the "Role" cell is empty',
      },
    ])
  })
})
