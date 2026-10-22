import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'
import { repository, useRepositories } from '../repository.fixture'

import { CONSUMER_ROOT, collectFromTest, RUNTIME_TEST_ANCHOR, scanConsumers } from './scan'

useRepositories()

const FIXTURES = join(import.meta.dirname, '../__fixtures__/consumers')

const collected = (name: string) =>
  collectFromTest(readFileSync(join(FIXTURES, name), 'utf8'), `consumers/${name}`)

describe('collectFromTest', () => {
  it('reads the anchor of a getByTestId call with a literal argument, at the line of the argument', () => {
    const { literals } = collected('known.ts')

    expect(literals.filter(({ line }) => line < 8 || line > 16)).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 6 },
      { kind: 'anchor', value: 'sample.mode-select.option', line: 7 },
      { kind: 'anchor', value: 'sample.list', line: 18 },
      { kind: 'anchor', value: 'sample.thing-item', line: 19 },
    ])
    expect(collectFromTest('page.getByTestId("sample.page")\n', 'a.ts').literals).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 1 },
    ])
  })
  it('reads the anchors, codes, states and values of the selectors in strings and templates', () => {
    const { literals, problems } = collected('known.ts')

    expect(literals.filter(({ line }) => line >= 8 && line <= 16)).toEqual([
      { kind: 'anchor', value: 'sample.save-button', line: 8 },
      { kind: 'code', value: 'saved', line: 8 },
      { kind: 'anchor', value: 'sample.list', line: 9 },
      { kind: 'state', value: 'loading', line: 9 },
      { kind: 'anchor', value: 'sample.mode-select.option', line: 10 },
      { kind: 'value', value: 'a', line: 10 },
      { kind: 'anchor', value: 'sample.key-select.option', line: 11 },
      { kind: 'value', value: 'k12', line: 11 },
      { kind: 'anchor', value: 'sample.thing-item', line: 13 },
      { kind: 'state', value: 'current', line: 13 },
      { kind: 'anchor', value: 'sample.save-button', line: 15 },
    ])
    expect(problems).toEqual([])
  })
  it('passes over a data-id, a code, state or value from an expression, and a selector that is not an equality', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test contains a template literal
    expect(collectFromTest('const s = `[data-value="${v}"][data-id="thg-1"]`\n', 'a.ts')).toEqual({
      file: 'a.ts',
      literals: [],
      problems: [],
    })
  })
  it('reports an anchor built at runtime: a getByTestId of a name or a template, a selector with an expression', () => {
    const { literals, problems } = collected('runtime.ts')

    expect(problems.map(formatProblem)).toEqual([
      `consumers/runtime.ts:7: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/runtime.ts:8: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/runtime.ts:9: ${RUNTIME_TEST_ANCHOR}`,
    ])
    expect(literals).toEqual([{ kind: 'anchor', value: 'sample.page', line: 10 }])
    expect(RUNTIME_TEST_ANCHOR).toBe(
      `an anchor built at runtime; write it as a literal, getByTestId('<anchor>') or [data-testid="<anchor>"]`,
    )
  })
  it('reads the code, state, value or anchor toHaveAttribute asserts, with .not too, at the line of the value', () => {
    const { literals, problems } = collected('attributes.ts')

    expect(literals).toEqual([
      { kind: 'anchor', value: 'sample.save-button', line: 6 },
      { kind: 'anchor', value: 'sample.list', line: 7 },
      { kind: 'code', value: 'saved', line: 9 },
      { kind: 'code', value: 'lost', line: 10 },
      { kind: 'state', value: 'loading', line: 11 },
      { kind: 'code', value: 'failed', line: 12 },
      { kind: 'anchor', value: 'sample.mode-select.option', line: 13 },
      { kind: 'value', value: 'c', line: 15 },
      { kind: 'anchor', value: 'sample.list', line: 17 },
    ])
    expect(problems).toEqual([])
    expect(
      collectFromTest('await expect(x).toHaveAttribute("data-state", "ready")\n', 'a.ts').literals,
    ).toEqual([{ kind: 'state', value: 'ready', line: 1 }])
  })
  it('passes over a value toHaveAttribute takes from an expression, but not an anchor', () => {
    const text =
      "expect(x).toHaveAttribute('data-code', code)\nexpect(x).toHaveAttribute('data-testid', id)\n"

    expect(collectFromTest(text, 'a.ts')).toEqual({
      file: 'a.ts',
      literals: [],
      problems: [{ file: 'a.ts', line: 2, message: RUNTIME_TEST_ANCHOR }],
    })
  })
  it('reads the line of a selector inside a template that spans lines', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the source under test contains a template literal
    const text = 'const s = `\n  ${a}\n  [data-testid="sample.page"]\n  [data-code="${b}"]`\n'

    expect(collectFromTest(text, 'a.ts').literals).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 3 },
    ])
  })
  it('reads a static string in any form: quotes, a template without an expression, a TypeScript wrapper', () => {
    const { literals } = collected('static.ts')

    expect(literals).toEqual([
      { kind: 'anchor', value: 'sample.list', line: 10 },
      { kind: 'anchor', value: 'sample.thing-item', line: 11 },
      { kind: 'state', value: 'loading', line: 13 },
      { kind: 'state', value: 'current', line: 14 },
    ])
    expect(collectFromTest("page.getByTestId(('sample.page'))\n", 'a.ts').literals).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 1 },
    ])
  })
  it('reports a template with an expression, a name or a call in place of an anchor, and skips one in place of a state', () => {
    expect(collected('static.ts').problems.map(formatProblem)).toEqual([
      `consumers/static.ts:15: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/static.ts:16: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/static.ts:17: ${RUNTIME_TEST_ANCHOR}`,
      `consumers/static.ts:19: ${RUNTIME_TEST_ANCHOR}`,
    ])
  })
  it('locates a selector by the lines of the source: an escaped line feed is none, a line continuation is one', () => {
    const escaped = `const s = '\\n[data-testid="sample.page"]'\nconst t = \`\\n[data-code="saved"]\`\n`
    const continued = `const s = 'x \\\n[data-testid="sample.page"]'\nconst t = \`x \\\n[data-code="saved"]\`\n`

    expect(collectFromTest(escaped, 'a.ts').literals).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 1 },
      { kind: 'code', value: 'saved', line: 2 },
    ])
    expect(collectFromTest(continued, 'a.ts').literals).toEqual([
      { kind: 'anchor', value: 'sample.page', line: 2 },
      { kind: 'code', value: 'saved', line: 4 },
    ])
  })
  it('does not parse a file without any of the words', () => {
    expect(collectFromTest('export const broken = {', 'plain.ts')).toEqual({
      file: 'plain.ts',
      literals: [],
      problems: [],
    })
  })
  it('reports a file it cannot parse', () => {
    const { problems } = collectFromTest("page.getByTestId('sample.page'", 'broken.ts')

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toMatch(/^cannot parse the file: /)
  })
})

describe('scanConsumers', () => {
  const TEST = "await page.getByTestId('sample.page').click()\n"

  it('collects the .ts files under tests/e2e/src, named by their paths from the root', () => {
    const root = repository({
      'tests/e2e/src/user/base/sign-up.e2e.spec.ts': TEST,
      'tests/e2e/src/support/fixtures.ts': TEST,
      'tests/e2e/src/user/base/sign-up.e2e.spec.ts-snapshots/page.png': TEST,
      'tests/e2e/scenarios/user/base/sign-up.md': TEST,
      'apps/web/src/page.ts': TEST,
    })

    expect(CONSUMER_ROOT).toBe('tests/e2e/src')
    expect(scanConsumers(root).map(({ file, literals }) => [file, literals.length])).toEqual([
      ['tests/e2e/src/support/fixtures.ts', 1],
      ['tests/e2e/src/user/base/sign-up.e2e.spec.ts', 1],
    ])
  })
  it('reads another folder of tests when one is given', () => {
    const root = repository({ 'tests/e2e/src/a.ts': TEST, 'other/tests/b.ts': TEST })

    expect(scanConsumers(root, 'other/tests').map(({ file }) => file)).toEqual(['other/tests/b.ts'])
  })
  it('fails, naming the folder, when the folder of tests cannot be read', () => {
    const root = repository({})

    expect(() => scanConsumers(root, 'missing/tests')).toThrow(
      'cannot read the tests in missing/tests',
    )
  })
})
