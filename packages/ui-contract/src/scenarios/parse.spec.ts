import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseScenario } from './parse'

const ID = 'sample/base/thing'

const fixture = readFileSync(
  join(import.meta.dirname, `../__fixtures__/tests/e2e/scenarios/${ID}.md`),
  'utf8',
)

const lineOf = (markdown: string, text: string): number =>
  markdown.slice(0, markdown.indexOf(text)).split('\n').length

/** A scenario file of the given front matter lines and body lines. */
const file = (header: readonly string[], body: readonly string[]): string =>
  ['---', ...header, '---', ...body, ''].join('\n')

describe('parseScenario', () => {
  it('reads every section of a file', () => {
    expect(parseScenario(ID, fixture)).toEqual({
      scenario: {
        id: ID,
        title: 'Edit the thing',
        tags: ['smoke'],
        devices: { A: 'member' },
        where: '[/sample]',
        data: { Title: 'generate' },
        scenario: 'A member renames the thing',
        steps: ['Open [/sample]', 'Enter the title into [sample.title-input]'],
        expected: ['[sample.save-button] saves with [code:saved]'],
      },
      problems: [],
    })
  })
  it('takes the sections in any order and keeps a fixed data value', () => {
    const markdown = file(
      [
        'data:',
        '  Idle minutes: "10"',
        '  Locale: es',
        'devices:',
        '  A: identity',
        'tags: [full]',
      ],
      [
        '### Expected result',
        '- At most two frames a minute',
        '',
        'Where: [/me]',
        '### Steps',
        '1. Wait',
        '2. Count the frames',
        '## Scenario: An idle tab stays quiet',
        '# Idle traffic',
      ],
    )

    expect(parseScenario('user/flows/idle-traffic', markdown)).toEqual({
      scenario: {
        id: 'user/flows/idle-traffic',
        title: 'Idle traffic',
        tags: ['full'],
        devices: { A: 'identity' },
        where: '[/me]',
        data: { 'Idle minutes': '10', Locale: 'es' },
        scenario: 'An idle tab stays quiet',
        steps: ['Wait', 'Count the frames'],
        expected: ['At most two frames a minute'],
      },
      problems: [],
    })
  })
  it('reads a file with CRLF or CR line endings as its LF twin', () => {
    const noData = fixture.replace('data:\n  Title: generate', 'data: {}')

    for (const markdown of [fixture, noData]) {
      expect(parseScenario(ID, markdown).problems).toEqual([])

      for (const ending of ['\r\n', '\r']) {
        expect(parseScenario(ID, markdown.replaceAll('\n', ending))).toEqual(
          parseScenario(ID, markdown),
        )
      }
    }
  })
  it('reports a missing section', () => {
    const markdown = fixture.replace(/### Steps\n[\s\S]*?(?=\n###)/, '')

    expect(parseScenario(ID, markdown)).toEqual({
      problems: [{ message: 'missing section "### Steps"' }],
    })
  })
  it('reports a line outside a section and an unknown heading, by line', () => {
    const markdown = fixture.replace('## Scenario:', 'A stray line\n\n## Notes\n\n## Scenario:')

    expect(parseScenario(ID, markdown)).toEqual({
      problems: [
        {
          line: lineOf(markdown, 'A stray line'),
          message: 'a line outside any section: "A stray line"',
        },
        { line: lineOf(markdown, '## Notes'), message: 'unknown heading "## Notes"' },
      ],
    })
  })
  it('reports a list item of the wrong shape, by line', () => {
    const markdown = fixture
      .replace('2. Enter the title', '- Enter the title')
      .replace('- [sample.save-button]', '1. [sample.save-button]')

    expect(parseScenario(ID, markdown).problems).toEqual([
      {
        line: lineOf(markdown, '- Enter the title'),
        message:
          'not a "1. <step>" item of "### Steps": "- Enter the title into [sample.title-input]"',
      },
      {
        line: lineOf(markdown, '1. [sample.save-button]'),
        message:
          'not a "- <result>" item of "### Expected result": "1. [sample.save-button] saves with [code:saved]"',
      },
    ])
  })
  it('reports an indented list line as no item of its section, by line', () => {
    const markdown = fixture
      .replace('2. Enter the title into [sample.title-input]', '$&\n   3. Press enter')
      .replace('- [sample.save-button] saves with [code:saved]', '$&\n  - and shows it')

    expect(parseScenario(ID, markdown).problems).toEqual([
      {
        line: lineOf(markdown, '   3. Press enter'),
        message: 'not a "1. <step>" item of "### Steps": "   3. Press enter"',
      },
      {
        line: lineOf(markdown, '  - and shows it'),
        message: 'not a "- <result>" item of "### Expected result": "  - and shows it"',
      },
    ])
  })
  it('reports a section that appears twice, by line', () => {
    const markdown = `${fixture}\n### Steps\n1. Once more\n`

    expect(parseScenario(ID, markdown).problems).toEqual([
      {
        line: markdown.split('\n').lastIndexOf('### Steps') + 1,
        message: 'section "### Steps" appears twice',
      },
    ])
  })
  it('reports an empty list by the line of its heading', () => {
    const markdown = fixture.replace(/(### Expected result\n)- .*\n/, '$1')

    expect(parseScenario(ID, markdown).problems).toEqual([
      {
        line: lineOf(markdown, '### Expected result'),
        message: 'expected: Too small: expected array to have >=1 items',
      },
    ])
  })
  it('reports a file without a front matter, and a front matter never closed', () => {
    expect(parseScenario(ID, fixture.replace(/^---\n[\s\S]*?\n---\n/, '')).problems).toEqual([
      {
        line: 1,
        message:
          'no front matter: the file opens with a "---" line, the YAML header and a "---" line',
      },
    ])
    expect(parseScenario(ID, fixture.replace('\n---\n# Edit', '\n# Edit')).problems).toEqual([
      { line: 1, message: 'the front matter has no closing "---" line' },
    ])
  })
  it('reports a front matter that is not YAML, by line', () => {
    const markdown = fixture.replace('  Title: generate', '  Title: generate\n  Title: fixed')

    expect(parseScenario(ID, markdown).problems).toEqual([
      {
        line: lineOf(markdown, '  Title: fixed'),
        message: 'the front matter is not YAML: Map keys must be unique',
      },
    ])
  })
  it('reports a device with a bad letter and a key the header does not hold, by line', () => {
    const markdown = fixture
      .replace('  A: member', '  a: member')
      .replace('tags:\n', 'id: sample/base/thing\ntags:\n')

    expect(parseScenario(ID, markdown).problems).toEqual([
      { line: lineOf(markdown, 'devices:'), message: 'devices.a: Invalid key in record' },
      { line: lineOf(markdown, 'id:'), message: '(root): Unrecognized key: "id"' },
    ])
  })
})
