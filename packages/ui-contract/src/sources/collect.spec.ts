import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'

import {
  collectFromSource,
  HOLDS_INPUT_ANCHOR,
  HOLDS_INPUT_VALUE,
  MARKS_STATE_ANCHOR,
  MARKS_STATE_VALUE,
  RUNTIME_ANCHOR,
  RUNTIME_SUFFIX,
} from './collect'

const FIXTURES = join(import.meta.dirname, '../__fixtures__/sources')

const collected = (name: string) =>
  collectFromSource(readFileSync(join(FIXTURES, name), 'utf8'), `sources/${name}`)

describe('collectFromSource', () => {
  it('reads a data-testid literal: a string, a literal in braces, a template without expressions', () => {
    const { literals } = collected('attributes.tsx')

    expect(literals.filter(({ form }) => form === 'attribute')).toEqual([
      { anchor: 'sample.page', form: 'attribute', line: 11 },
      { anchor: 'sample.title-input', form: 'attribute', line: 12 },
      { anchor: 'sample.save-button', form: 'attribute', line: 13 },
    ])
  })
  it('reads a testId prop and a prop whose name ends in TestId', () => {
    const { literals } = collected('attributes.tsx')

    expect(literals.filter(({ form }) => form === 'prop')).toEqual([
      { anchor: 'sample.mode-select', form: 'prop', line: 14 },
      { anchor: 'sample.home-link', form: 'prop', line: 15 },
    ])
  })
  it('lets an identifier, a member expression and a testIdFor() call pass through', () => {
    const { literals, problems } = collected('attributes.tsx')

    expect(literals).toHaveLength(5)
    expect(problems).toEqual([])
  })
  it('refuses an anchor built at runtime: a template, a +, a conditional or any other value', () => {
    const { literals, problems } = collected('runtime.tsx')

    expect(literals).toEqual([])
    expect(problems.map(formatProblem)).toEqual([
      `sources/runtime.tsx:5: ${RUNTIME_ANCHOR}`,
      `sources/runtime.tsx:7: ${RUNTIME_ANCHOR}`,
      `sources/runtime.tsx:8: ${RUNTIME_ANCHOR}`,
      `sources/runtime.tsx:9: ${RUNTIME_ANCHOR}`,
      `sources/runtime.tsx:14: ${RUNTIME_ANCHOR}`,
    ])
    expect(RUNTIME_ANCHOR).toBe(
      'an anchor built at runtime; declare a literal, pass a prop or a <NAME>_TEST_ID constant, or derive it with testIdFor()',
    )
  })
  it('reads a literal testId key, and lets a key whose value is a name pass through', () => {
    const { literals, problems } = collected('keys.tsx')

    expect(literals.filter(({ form }) => form === 'key')).toEqual([
      { anchor: 'sample.thing-item', form: 'key', line: 7 },
      { anchor: 'sample.key-select', form: 'key', line: 8 },
    ])
    expect(problems).toEqual([])
  })
  it('reads a <NAME>_TEST_ID constant, not a constant named otherwise', () => {
    const { literals } = collected('keys.tsx')

    expect(literals.filter(({ form }) => form === 'constant')).toEqual([
      { anchor: 'sample.list', form: 'constant', line: 2 },
    ])
    expect(literals.map(({ anchor }) => anchor)).not.toContain('not.a-constant')
  })
  it('records the literal suffix of testIdFor(), its base when a literal, and refuses a suffix built at runtime', () => {
    const { derived, problems } = collected('derived.tsx')
    const eye = { suffix: 'visibility-button', base: 'sample.title-input' }

    expect(derived).toEqual([
      { suffix: 'option', line: 5 },
      { suffix: 'confirm-button', line: 7 },
      { ...eye, line: 11 },
      { ...eye, line: 13 },
      { ...eye, line: 16 },
      { ...eye, line: 19 },
      { suffix: 'confirm-button', base: 'sample.gone-dialog', line: 21 },
    ])
    expect(problems.map(formatProblem)).toEqual([`sources/derived.tsx:9: ${RUNTIME_SUFFIX}`])
    expect(collected('attributes.tsx').derived).toEqual([{ suffix: 'item', line: 18 }])
  })
  it('reads the codes: a data-code literal, a code key and the literals of a <NAME>_CODES map', () => {
    const { codes, literals } = collected('codes.tsx')

    expect(codes).toEqual([
      { code: 'saved', form: 'map', line: 3 },
      { code: 'failed', form: 'map', line: 4 },
      { code: 'not-a-code', form: 'key', line: 9 },
      { code: 'welcome', form: 'key', line: 13 },
      { code: 'saved', form: 'attribute', line: 18 },
      { code: 'devices-read-failed', form: 'attribute', line: 19 },
    ])
    expect(literals).toEqual([])
  })
  it('leaves out a code key or a map value that is a domain code, not a kebab-case one', () => {
    const { codes } = collected('codes.tsx')

    expect(codes.map(({ code }) => code)).not.toContain('note:TEXT_REQUIRED')
    expect(codes.map(({ code }) => code)).not.toContain('bus:FAILED')
  })
  it('refuses a data-code literal that is not a kebab-case code', () => {
    const { problems } = collected('codes.tsx')

    expect(problems.map(formatProblem)).toEqual([
      'sources/codes.tsx:21: data-code "Bad:Code" is not a kebab-case code',
    ])
  })
  it('does not parse a file without any of the words', () => {
    expect(collectFromSource('export const broken = {', 'sources/plain.ts')).toEqual({
      file: 'sources/plain.ts',
      literals: [],
      derived: [],
      codes: [],
      inputs: [],
      colours: [],
      props: [],
      problems: [],
    })
  })
  it('collects maxLength, type, aria-invalid and disabled beside the anchor of their element, as written', () => {
    const found = collectFromSource(
      [
        '// A word of another script — ü — keeps the offsets of the text.',
        'const a = <Input data-testid="x.form.name-input" maxLength={80} />',
        "const b = <PasswordInput {...field('password')} aria-invalid={concerns === 'password' ? true : undefined} testId=\"x.form.password-input\" />",
        'const c = <Button',
        '  disabled={',
        '    !props.can({',
        "      type: 'x.form.save-button',",
        '    })',
        '  }',
        '  data-testid="x.form.save-button"',
        '/>',
        'const d = <Input data-testid="x.form.code-input" maxLength="6" disabled />',
        'const e = <Input data-testid="x.form.email-input" type="email" />',
        'const f = <Input type={shown ? "text" : "password"} data-testid="x.form.secret-input" />',
      ].join('\n'),
      'x.tsx',
    )

    expect(found.props).toEqual([
      { anchor: 'x.form.name-input', name: 'maxLength', text: '80', line: 2 },
      {
        anchor: 'x.form.password-input',
        name: 'aria-invalid',
        text: "concerns === 'password' ? true : undefined",
        line: 3,
      },
      {
        anchor: 'x.form.save-button',
        name: 'disabled',
        text: "!props.can({ type: 'x.form.save-button', })",
        line: 5,
      },
      { anchor: 'x.form.code-input', name: 'maxLength', text: '"6"', line: 12 },
      { anchor: 'x.form.code-input', name: 'disabled', text: '', line: 12 },
      { anchor: 'x.form.email-input', name: 'type', text: '"email"', line: 13 },
      {
        anchor: 'x.form.secret-input',
        name: 'type',
        text: 'shown ? "text" : "password"',
        line: 14,
      },
    ])
    expect(found.problems).toEqual([])
  })
  it("collects them beside a testIdFor() of two literals, with the derived anchor's base", () => {
    const found = collectFromSource(
      "const a = <OptionSelect testId={testIdFor('x.list', 'size-select')} disabled={!can(event)} />",
      'x.tsx',
    )

    expect(found.props).toEqual([
      {
        anchor: 'x.list.size-select',
        base: 'x.list',
        name: 'disabled',
        text: '!can(event)',
        line: 1,
      },
    ])
  })
  it('leaves them out on an element whose anchor is passed through or missing, with no problem', () => {
    const found = collectFromSource(
      [
        'const a = <Select data-testid={props.testId} disabled={props.disabled} />',
        'const b = <Input maxLength={80} aria-invalid={invalid} />',
        "const c = <Input data-testid={testIdFor(list, 'size-select')} disabled={busy} />",
      ].join('\n'),
      'x.tsx',
    )

    expect(found.props).toEqual([])
    expect(found.problems).toEqual([])
  })
  it('follows a <NAME>_TEST_ID constant of the file, in the scope that sees it, to its anchor', () => {
    const found = collectFromSource(
      [
        "const TITLE_TEST_ID = 'x.form.title-input'",
        "const LIST_TEST_ID = 'x.list'",
        'const a = <Input data-testid={TITLE_TEST_ID} maxLength={80} holdsInput={false} />',
        "const b = <Select testId={testIdFor(LIST_TEST_ID, 'size-select')} disabled={busy} />",
        'function View({ TITLE_TEST_ID }) { return <Input data-testid={TITLE_TEST_ID} maxLength={1} /> }',
        'const c = <Input data-testid={OTHER_TEST_ID} maxLength={2} />',
      ].join('\n'),
      'x.tsx',
    )

    // A parameter hides the constant, and a constant the file does not declare is passed through.
    expect(found.props).toEqual([
      { anchor: 'x.form.title-input', name: 'maxLength', text: '80', line: 3 },
      { anchor: 'x.list.size-select', base: 'x.list', name: 'disabled', text: 'busy', line: 4 },
    ])
    expect(found.inputs).toEqual([{ anchor: 'x.form.title-input', holdsInput: false, line: 3 }])
    expect(found.problems).toEqual([])
  })
  it('collects holdsInput beside the anchor of its element, and lets a passed value through', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid="x.form.name-input" holdsInput={false} />',
        'const b = <OptionSelect testId="x.page.kind-select" holdsInput={true} />',
        'const c = <Select holdsInput={props.holdsInput} />',
      ].join('\n'),
      'x.tsx',
    )

    expect(found.inputs).toEqual([
      { anchor: 'x.form.name-input', holdsInput: false, line: 1 },
      { anchor: 'x.page.kind-select', holdsInput: true, line: 2 },
    ])
    expect(found.problems).toEqual([])
  })
  it('collects a holdsInput written as a name or a member on the element of an anchor, as written', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid="x.form.name-input" holdsInput={localFlag} />',
        'const b = <OptionSelect testId="x.page.kind-select" holdsInput={props.hold} />',
        "const c = <OptionSelect testId={testIdFor('x.list', 'size-select')} holdsInput={flag} />",
      ].join('\n'),
      'x.tsx',
    )

    expect(found.inputs).toEqual([
      { anchor: 'x.form.name-input', holdsInput: 'localFlag', line: 1 },
      { anchor: 'x.page.kind-select', holdsInput: 'props.hold', line: 2 },
      { anchor: 'x.list.size-select', base: 'x.list', holdsInput: 'flag', line: 3 },
    ])
    expect(found.problems).toEqual([])
  })
  it('collects a marksState written as a name or a member on the element of an anchor, as written', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid="x.form.name-input" marksState={ props.mark } />',
        'const b = <Textarea testId="x.form.note-input" marksState={mark} />',
        "const c = <OptionSelect testId={testIdFor('x.list', 'size-select')} marksState={state.mark} />",
      ].join('\n'),
      'x.tsx',
    )

    expect(found.colours).toEqual([
      { anchor: 'x.form.name-input', marksState: 'props.mark', line: 1 },
      { anchor: 'x.form.note-input', marksState: 'mark', line: 2 },
      { anchor: 'x.list.size-select', base: 'x.list', marksState: 'state.mark', line: 3 },
    ])
    expect(found.problems).toEqual([])
  })
  it('lets a wrapper pass a flag on beside an anchor it passes on, which no check can read', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid={testId} holdsInput={holdsInput} marksState={props.marksState} />',
        'const b = <Input testId={props.testId} holdsInput={props.holdsInput} marksState={marksState} />',
        "const c = <Input testId={testIdFor(base, 'name-input')} holdsInput={holdsInput} />",
        "const d = <Input testId={testIdFor('x.form', suffix)} marksState={marksState} />",
      ].join('\n'),
      'x.tsx',
    )

    expect(found.inputs).toEqual([])
    expect(found.colours).toEqual([])
    expect(found.problems.filter(({ message }) => message !== RUNTIME_SUFFIX)).toEqual([])
  })
  it('reports holdsInput that is neither a boolean literal nor passed, or sits on no anchor', () => {
    const found = collectFromSource(
      [
        'const a = <Input holdsInput={false} />',
        'const b = <Input data-testid="x.form.name-input" holdsInput={1 > 0} />',
      ].join('\n'),
      'x.tsx',
    )

    expect(found.inputs).toEqual([])
    expect(found.problems.map(({ line, message }) => [line, message])).toEqual([
      [1, HOLDS_INPUT_ANCHOR],
      [2, HOLDS_INPUT_VALUE],
    ])
  })
  it('collects marksState beside the anchor of its element, and lets a passed value through', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid="x.form.name-input" marksState={false} />',
        'const b = <PasswordInput testId="x.form.password-input" marksState={false} />',
        'const c = <Input data-testid="x.form.code-input" holdsInput={false} marksState={false} />',
        'const d = <Input marksState={props.marksState} />',
        'const e = <Textarea marksState={marksState} />',
      ].join('\n'),
      'x.tsx',
    )

    expect(found.colours).toEqual([
      { anchor: 'x.form.name-input', marksState: false, line: 1 },
      { anchor: 'x.form.password-input', marksState: false, line: 2 },
      { anchor: 'x.form.code-input', marksState: false, line: 3 },
    ])
    expect(found.inputs).toEqual([{ anchor: 'x.form.code-input', holdsInput: false, line: 3 }])
    expect(found.problems).toEqual([])
  })
  it('reports marksState that is neither a boolean literal nor passed, or sits on no anchor', () => {
    const found = collectFromSource(
      [
        'const a = <Input marksState={false} />',
        'const b = <Input data-testid="x.form.name-input" marksState={1 > 0} />',
      ].join('\n'),
      'x.tsx',
    )

    expect(found.colours).toEqual([])
    expect(found.problems.map(({ line, message }) => [line, message])).toEqual([
      [1, MARKS_STATE_ANCHOR],
      [2, MARKS_STATE_VALUE],
    ])
    expect(MARKS_STATE_VALUE).toBe(
      "marksState is neither a boolean literal nor a prop passed through: the kit takes it from the contract's field facts; leave it out",
    )
  })
  it("collects holdsInput beside a testIdFor() of two literals, with the derived anchor's base", () => {
    const found = collectFromSource(
      [
        "const a = <OptionSelect testId={testIdFor('x.list', 'size-select')} holdsInput={false} />",
        'const b = <OptionSelect testId={testIdFor(`x.list`, `size-select`)} holdsInput={false} />',
      ].join('\n'),
      'x.tsx',
    )
    const size = { anchor: 'x.list.size-select', base: 'x.list', holdsInput: false }

    expect(found.inputs).toEqual([
      { ...size, line: 1 },
      { ...size, line: 2 },
    ])
    expect(found.problems).toEqual([])
  })
  it("collects marksState beside a testIdFor() of two literals, with the derived anchor's base", () => {
    const found = collectFromSource(
      "const a = <OptionSelect testId={testIdFor('x.list', 'size-select')} marksState={false} />",
      'x.tsx',
    )

    expect(found.colours).toEqual([
      { anchor: 'x.list.size-select', base: 'x.list', marksState: false, line: 1 },
    ])
    expect(found.problems).toEqual([])
  })
  it('keeps the anchor problem for a testIdFor() whose base or suffix is not a literal', () => {
    const found = collectFromSource(
      [
        "const a = <OptionSelect testId={testIdFor(list, 'size-select')} holdsInput={false} />",
        'const b = <OptionSelect testId={testIdFor(list, suffix)} marksState={false} />',
        "const c = <OptionSelect testId={testIdFor('x.list', suffix)} holdsInput={false} />",
        "const d = <OptionSelect testId={testIdFor('x.list')} marksState={false} />",
      ].join('\n'),
      'x.tsx',
    )

    const anchorProblems = found.problems.filter(({ message }) => message !== RUNTIME_SUFFIX)

    expect(found.inputs).toEqual([])
    expect(found.colours).toEqual([])
    expect(anchorProblems.map(({ line, message }) => [line, message])).toEqual([
      [1, HOLDS_INPUT_ANCHOR],
      [2, MARKS_STATE_ANCHOR],
      [3, HOLDS_INPUT_ANCHOR],
      [4, MARKS_STATE_ANCHOR],
    ])
  })
  it('words the anchor problems to name a testIdFor() of two literals, and to leave the flag to the kit', () => {
    expect(HOLDS_INPUT_ANCHOR).toBe(
      "holdsInput on an element that carries no anchor as a literal or as testIdFor() of two literals: the kit takes it from the contract's field facts; leave it out",
    )
    expect(MARKS_STATE_ANCHOR).toBe(
      "marksState on an element that carries no anchor as a literal or as testIdFor() of two literals: the kit takes it from the contract's field facts; leave it out",
    )
  })
  it('reports a file it cannot parse', () => {
    const { problems } = collectFromSource('const X_TEST_ID = {', 'sources/broken.ts')

    expect(problems).toHaveLength(1)
    expect(problems[0]?.message).toMatch(/^cannot parse the file: /)
  })
})
