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
  UNDECLARED_ANCHOR,
  UNFOLLOWED_SPREAD,
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
        asks: 'x.form.save-button',
        question: true,
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
    // `field` is no name of this file: its spread on an element whose anchor is read is refused.
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:3: ${UNFOLLOWED_SPREAD('x.form.password-input')}`,
    ])
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
        question: true,
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

    // A parameter hides the constant and passes its anchor on; a constant the file does not
    // declare (an import) is read nowhere, so it is refused.
    expect(found.props).toEqual([
      { anchor: 'x.form.title-input', name: 'maxLength', text: '80', line: 3 },
      { anchor: 'x.list.size-select', base: 'x.list', name: 'disabled', text: 'busy', line: 4 },
    ])
    expect(found.inputs).toEqual([{ anchor: 'x.form.title-input', holdsInput: false, line: 3 }])
    expect(found.derived).toEqual([{ suffix: 'size-select', base: 'x.list', line: 4 }])
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:6: ${UNDECLARED_ANCHOR('OTHER_TEST_ID')}`,
    ])
  })
  it('collects what a spread on the element supplies: an object written there, held, or returned by a helper', () => {
    const found = collectFromSource(
      [
        'const limits = { maxLength: 80 }',
        'const field = (name) => ({ id: name, ...limits })',
        "function password(name) { const shown = false; return { ...field(name), type: shown ? 'text' : 'password' } }",
        'const a = <Input data-testid="x.form.name-input" {...{ maxLength: 1 }} />',
        'const b = <Input data-testid="x.form.email-input" {...field(\'email\')} />',
        'const c = <Input data-testid="x.form.secret-input" {...password(\'secret\')} holdsInput={false} />',
        'const d = <Input data-testid="x.form.note-input" {...props} {...rest()} />',
        'const e = <Input data-testid="x.form.flag-input" {...{ marksState: false, holdsInput: props.holds }} />',
      ].join('\n'),
      'x.tsx',
    )

    // A spread the file cannot follow (a component's own props, a function declared elsewhere) supplies nothing.
    expect(found.props).toEqual([
      { anchor: 'x.form.name-input', name: 'maxLength', text: '1', line: 4 },
      { anchor: 'x.form.email-input', name: 'maxLength', text: '80', line: 5 },
      { anchor: 'x.form.secret-input', name: 'maxLength', text: '80', line: 6 },
      { anchor: 'x.form.secret-input', name: 'type', text: "shown ? 'text' : 'password'", line: 6 },
    ])
    expect(found.inputs).toEqual([
      { anchor: 'x.form.secret-input', holdsInput: false, line: 6 },
      { anchor: 'x.form.flag-input', holdsInput: 'props.holds', line: 8 },
    ])
    expect(found.colours).toEqual([{ anchor: 'x.form.flag-input', marksState: false, line: 8 }])
    // Neither spread on the note input can be followed, and its anchor is read: both are refused.
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:7: ${UNFOLLOWED_SPREAD('x.form.note-input')}`,
      `x.tsx:7: ${UNFOLLOWED_SPREAD('x.form.note-input')}`,
    ])
  })
  it('refuses a spread on an element whose anchor is read when a key of its object cannot be read', () => {
    const found = collectFromSource(
      [
        'const a = <Input data-testid="x.form.name-input" {...{ [limitKey]: 3 }} />',
        'const b = <Input data-testid="x.form.email-input" {...{ get maxLength() { return 3 } }} />',
        'const c = <Input data-testid="x.form.note-input" {...{ [\'maxLength\']: 3, onChange() {} }} />',
      ].join('\n'),
      'x.tsx',
    )

    // A computed string literal is its name, and a method supplies nothing.
    expect(found.props).toEqual([
      { anchor: 'x.form.note-input', name: 'maxLength', text: '3', line: 3 },
    ])
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:1: ${UNFOLLOWED_SPREAD('x.form.name-input')}`,
      `x.tsx:2: ${UNFOLLOWED_SPREAD('x.form.email-input')}`,
    ])
  })
  it('holds an element to the anchor its spread supplies in every branch the file can follow', () => {
    const base = [
      "const layoutKey = 'compact'",
      "const searchProps = { 'data-testid': 'x.form.search-input' }",
    ]
    const stated = collectFromSource(
      [
        ...base,
        'const inputProps = { search: searchProps, [layoutKey]: { size: 1 } }',
        'const a = <Input {...inputProps.search} maxLength={3} />',
      ].join('\n'),
      'x.tsx',
    )

    // `[layoutKey]` is 'compact', so `inputProps.search` is the search props and nothing else.
    expect(stated.props).toEqual([
      { anchor: 'x.form.search-input', name: 'maxLength', text: '3', line: 4 },
    ])
    expect(stated.problems).toEqual([])

    const unsure = collectFromSource(
      [
        ...base,
        'const inputProps = { search: searchProps, [props.layout]: { size: 1 } }',
        'const a = <Input {...inputProps.search} maxLength={3} />',
      ].join('\n'),
      'x.tsx',
    )

    // `[props.layout]` may be 'search': one branch cannot be followed, the other still gives the anchor.
    expect(unsure.props).toEqual([
      { anchor: 'x.form.search-input', name: 'maxLength', text: '3', line: 4 },
    ])
    expect(unsure.problems.map(formatProblem)).toEqual([
      `x.tsx:4: ${UNFOLLOWED_SPREAD('x.form.search-input')}`,
    ])
  })
  it('leaves an anchor unread where the branches the file can follow supply different ones, or one leaves it out', () => {
    const found = collectFromSource(
      [
        "const a = <Input {...(ok ? { 'data-testid': 'x.form.a-input' } : more ? { 'data-testid': 'x.form.b-input' } : props)} maxLength={3} />",
        "const b = <Input {...(ok ? { 'data-testid': 'x.form.c-input' } : more ? { id: 'c' } : props)} maxLength={3} />",
      ].join('\n'),
      'x.tsx',
    )

    // No anchor all the followed branches share: the element reads none, as before.
    expect(found.props).toEqual([])
    expect(found.problems).toEqual([])
  })
  it('reads a computed key a constant of the file holds, and refuses one it cannot state, on an anchored element', () => {
    const found = collectFromSource(
      [
        "const LABEL_PROP = 'aria-label'",
        'function field(KEY) { return <Input data-testid="x.form.d-input" {...{ [KEY]: 1 }} /> }',
        'function hidden(LABEL_PROP) { return <Input data-testid="x.form.e-input" {...{ [LABEL_PROP]: 1 }} /> }',
        'const a = <Input data-testid="x.form.search-input" {...{ [LABEL_PROP]: t(\'search\') }} />',
        'const b = <Input data-testid="x.form.b-input" {...{ [imported]: 1 }} />',
      ].join('\n'),
      'x.tsx',
    )

    // A constant of the file is its string: no problem. A parameter that hides it, a name of
    // another file and a parameter are not stated: the spread is refused.
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:2: ${UNFOLLOWED_SPREAD('x.form.d-input')}`,
      `x.tsx:3: ${UNFOLLOWED_SPREAD('x.form.e-input')}`,
      `x.tsx:5: ${UNFOLLOWED_SPREAD('x.form.b-input')}`,
    ])
  })
  it('states a computed key of a spread by a const only: a reassigned let or a var is not followed', () => {
    const view = (declarations: readonly string[]) =>
      collectFromSource(
        [
          ...declarations,
          'const extra = { [prop]: 3 }',
          'const a = <Input data-testid="x.form.search-input" {...extra} />',
        ].join('\n'),
        'x.tsx',
      )
    const stated = view(["const prop = 'maxLength'"])

    expect(stated.props).toEqual([
      { anchor: 'x.form.search-input', name: 'maxLength', text: '3', line: 3 },
    ])
    expect(stated.problems).toEqual([])

    for (const declarations of [
      ["let prop = 'tabIndex'", "if (compact) prop = 'maxLength'"],
      ["let prop = 'maxLength'"],
      ["var prop = 'maxLength'"],
    ]) {
      const found = view(declarations)

      expect(found.props).toEqual([])
      expect(found.problems.map(formatProblem)).toEqual([
        `x.tsx:${declarations.length + 2}: ${UNFOLLOWED_SPREAD('x.form.search-input')}`,
      ])
    }
  })
  it('reads an object key a const of the file states as an anchor key and as a code key, and no other', () => {
    const found = collectFromSource(
      [
        "const TEST_ID_PROP = 'data-testid'",
        "const CODE_KEY = 'code'",
        "const a = { [TEST_ID_PROP]: 'x.form.seach-input', [CODE_KEY]: 'welcome' }",
        'const b = { [TEST_ID_PROP]: OTHER_TEST_ID }',
        "let letKey = 'data-testid'",
        "const c = { [letKey]: 'x.form.other-input', [props.key]: 'x.form.third-input' }",
      ].join('\n'),
      'x.tsx',
    )

    expect(found.literals).toEqual([{ anchor: 'x.form.seach-input', form: 'key', line: 3 }])
    expect(found.codes).toEqual([{ code: 'welcome', form: 'key', line: 3 }])
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:4: ${UNDECLARED_ANCHOR('OTHER_TEST_ID')}`,
    ])
  })
  it('reads a key a loop variable or a catch parameter names in their own scope, not by the const around them', () => {
    const view = (inside: string) =>
      collectFromSource(
        [
          'function View() {',
          "  const prop = 'data-testid'",
          '  const labels = {}',
          `  ${inside}`,
          "  const anchorProps = { [prop]: 'x.users.search-input' }",
          "  return <Input {...anchorProps} aria-label={labels['aria-label']} />",
          '}',
        ].join('\n'),
        'x.tsx',
      )
    const label = "Object.assign(labels, { [prop]: t('x.users.search') })"
    const search = { anchor: 'x.users.search-input', form: 'key', line: 5 }

    for (const inside of [
      `for (const prop of ['aria-label'] as const) { ${label} }`,
      `for (const prop in { 'aria-label': 1 }) ${label}`,
      `try { load() } catch (prop) { ${label} }`,
    ]) {
      const found = view(inside)

      // The loop's or the catch's own name has no value the file states: the key is not read.
      expect(found.problems).toEqual([])
      // After it, the const is read again.
      expect(found.literals).toEqual([search])
    }

    // The const itself, and a const in a loop's head, still state the key: a runtime anchor.
    for (const inside of [
      label,
      `for (const prop = 'data-testid'; ok; ) { ${label} }`,
      `try { load() } catch { ${label} }`,
    ]) {
      const found = view(inside)

      expect(found.problems.map(formatProblem)).toEqual([`x.tsx:4: ${RUNTIME_ANCHOR}`])
      expect(found.literals).toEqual([search])
    }
  })
  it('reads the variable of a for…of as each element of the array it iterates, the file stating it', () => {
    const view = (fields: string) =>
      collectFromSource(
        [
          "const SEARCH_TEST_ID = 'x.users.search-input'",
          "const inputProps = { 'data-testid': SEARCH_TEST_ID }",
          `const fields = ${fields}`,
          'const inputs = []',
          'for (const inputProps of fields) {',
          "  inputs.push(<Input key={inputProps['data-testid']} {...inputProps} maxLength={3} />)",
          '}',
        ].join('\n'),
        'x.tsx',
      )
    const limit = { anchor: 'x.users.search-input', name: 'maxLength', text: '3', line: 6 }
    const looped = view('[inputProps]')

    // The loop's own `inputProps` is each element of `fields`: the outer object, with its anchor.
    expect(looped.props).toEqual([limit])
    expect(looped.problems).toEqual([])

    // A spread element beside it cannot be followed: the anchor is still read, the spread refused.
    const spread = view('[...more, inputProps]')

    expect(spread.props).toEqual([limit])
    expect(spread.problems.map(formatProblem)).toEqual([
      `x.tsx:6: ${UNFOLLOWED_SPREAD('x.users.search-input')}`,
    ])

    // An array the file says nothing of leaves the anchor unread, as a wrapper's.
    for (const fields of ['[...more]', 'props.fields']) {
      const found = view(fields)

      expect(found.props).toEqual([])
      expect(found.problems).toEqual([])
    }
  })
  it('holds an element to the anchor a value under a key the file does not state reads as', () => {
    const view = (lines: readonly string[]) =>
      collectFromSource(
        [
          "const SEARCH_TEST_ID = 'x.users.search-input'",
          "let prop: string = 'data-testid'",
          ...lines,
        ].join('\n'),
        'x.tsx',
      )
    const limit = { anchor: 'x.users.search-input', name: 'maxLength', text: '3', line: 6 }
    const refused = `x.tsx:6: ${UNFOLLOWED_SPREAD('x.users.search-input')}`

    // The key may be the anchor's: the element is held to it, and both spreads are refused.
    for (const value of ['SEARCH_TEST_ID', "'x.users.search-input'"]) {
      const found = view([
        `const anchorProps = { ...{ [prop]: ${value} } }`,
        "prop = 'aria-label'",
        "const labelProps = { [prop]: t('x.users.search') }",
        'const a = <Input {...anchorProps} {...labelProps} maxLength={3} />',
      ])

      expect(found.props).toEqual([limit])
      expect(found.problems.map(formatProblem)).toEqual([refused, refused])
    }

    // An anchor the element carries otherwise stays its anchor.
    const written = view([
      'const anchorProps = { [prop]: SEARCH_TEST_ID }',
      '',
      '',
      'const a = <Input data-testid="x.users.name-input" {...anchorProps} maxLength={3} />',
    ])

    expect(written.props).toEqual([{ ...limit, anchor: 'x.users.name-input' }])
    expect(written.problems.map(formatProblem)).toEqual([
      `x.tsx:6: ${UNFOLLOWED_SPREAD('x.users.name-input')}`,
    ])
  })
  it('changes nothing for a key the file does not state whose value reads as no anchor, or as two', () => {
    const found = collectFromSource(
      [
        "const SEARCH_TEST_ID = 'x.users.search-input'",
        "let prop: string = 'data-testid'",
        "const labelProps = { [prop]: t('x.users.search'), [props.key]: 'Search users' }",
        'const a = <Input {...labelProps} {...{ [prop]: 3 }} maxLength={3} />',
        "const b = <Input {...{ [prop]: SEARCH_TEST_ID }} {...{ [prop]: 'x.users.other-input' }} maxLength={3} />",
      ].join('\n'),
      'x.tsx',
    )

    // No anchor read: the elements are let by, as a wrapper's.
    expect(found.props).toEqual([])
    expect(found.problems).toEqual([])
  })
  it('reads the event a disabled asks about: written there, or held by a constant the scope sees', () => {
    const found = collectFromSource(
      [
        "const revoke = { type: 'x.sessions.revoke-button' } as const",
        "const reset = { type: 'x.reset.send-button' } as const",
        'const a = <Button data-testid="x.sessions.revoke-button" disabled={!props.can(revoke)} />',
        'const b = <Button data-testid="x.sessions.revoke-button" disabled={!props.can(reset)} />',
        "const c = <Button data-testid=\"x.help.confirm-button\" disabled={!can({ type: testIdFor('x.help', 'confirm-button') })} />",
        'function View(revoke) { return <Button data-testid="x.sessions.revoke-button" disabled={!props.can(revoke)} /> }',
        "const d = <Button data-testid=\"x.page.go-button\" disabled={!props.can(ok ? { type: 'x.page.go-button' } : { type: 'x.page.stop-button' })} />",
      ].join('\n'),
      'x.tsx',
    )

    // A parameter's event, or one of two, cannot be read: no `asks`.
    expect(found.props.map(({ anchor, asks, line }) => ({ anchor, asks, line }))).toEqual([
      { anchor: 'x.sessions.revoke-button', asks: 'x.sessions.revoke-button', line: 3 },
      { anchor: 'x.sessions.revoke-button', asks: 'x.reset.send-button', line: 4 },
      { anchor: 'x.help.confirm-button', asks: 'x.help.confirm-button', line: 5 },
      { anchor: 'x.sessions.revoke-button', asks: undefined, line: 6 },
      { anchor: 'x.page.go-button', asks: undefined, line: 7 },
    ])
  })
  it('reads an event as its object ends up, where it is written; anything it cannot follow leaves it unread', () => {
    const found = collectFromSource(
      [
        "const revoke = { type: 'x.sessions.revoke-button' } as const",
        "const reset = { type: 'x.reset.send-button' } as const",
        'const a = <Button data-testid="x.sessions.revoke-button" disabled={!props.can({ ...revoke, reason })} />',
        'const b = <Button data-testid="x.sessions.revoke-button" disabled={!props.can({ ...revoke, ...(ok ? reset : {}) })} />',
        'const c = <Button data-testid="x.sessions.revoke-button" disabled={!props.can(ok ? revoke : props.event)} />',
        'const d = <Button data-testid="x.sessions.revoke-button" disabled={!other.can(revoke)} />',
        "const extras = () => { const event = { type: 'x.sessions.revoke-button' } as const; return { disabled: !props.can(event) } }",
        'const e = <Button data-testid="x.sessions.revoke-button" {...extras()} />',
        'const f = <Button data-testid="x.sessions.revoke-button" disabled={!props.can({ type: \'x.sessions.revoke-button\', ...rest })} />',
      ].join('\n'),
      'x.tsx',
    )

    // b: the reset may override; c: one alternative is unknown; d: not the machine's question;
    // e: the helper's own constant; f: a spread the file cannot follow is the event's data.
    expect(found.props.map(({ asks, line }) => ({ asks, line }))).toEqual([
      { asks: 'x.sessions.revoke-button', line: 3 },
      { asks: undefined, line: 4 },
      { asks: undefined, line: 5 },
      { asks: undefined, line: 6 },
      { asks: 'x.sessions.revoke-button', line: 8 },
      { asks: 'x.sessions.revoke-button', line: 9 },
    ])
  })
  it('reads a hoisted part through its constant base, and an anchor key of a spread, held to the import rule', () => {
    const found = collectFromSource(
      [
        "const DIALOG_TEST_ID = 'x.help-dialog'",
        "const CONFIRM_TEST_ID = testIdFor(DIALOG_TEST_ID, 'confirm-button')",
        'const a = <Button testId={CONFIRM_TEST_ID} disabled={!props.can(confirm)} />',
        "const b = <Input {...{ 'data-testid': 'x.form.email-input', maxLength: 1 }} />",
        'const c = <Input {...{ testId: IMPORTED_TEST_ID }} />',
      ].join('\n'),
      'x.tsx',
    )

    expect(
      found.props.map(({ anchor, base, name, line }) => ({ anchor, base, name, line })),
    ).toEqual([
      { anchor: 'x.help-dialog.confirm-button', base: 'x.help-dialog', name: 'disabled', line: 3 },
      { anchor: 'x.form.email-input', base: undefined, name: 'maxLength', line: 4 },
    ])
    expect(found.literals.filter(({ form }) => form === 'key')).toEqual([
      { anchor: 'x.form.email-input', form: 'key', line: 4 },
    ])
    expect(found.problems.map(formatProblem)).toEqual([
      `x.tsx:5: ${UNDECLARED_ANCHOR('IMPORTED_TEST_ID')}`,
    ])
  })
  it('reads the question from the tree: a nested builder, an untyped spread, something beside it', () => {
    const found = collectFromSource(
      [
        "const createEvent = (draft) => ({ type: 'x.create.submit-button', ...draft })",
        "const revoke = { type: 'x.sessions.revoke-button' } as const",
        'const a = <Button data-testid="x.create.submit-button" disabled={!props.can(createEvent(readDraft()))} />',
        'function Row({ checkEvent }) { return <Button data-testid="x.sessions.revoke-button" disabled={!props.can({ ...revoke, ...checkEvent })} /> }',
        'const b = <Button data-testid="x.sessions.revoke-button" disabled={!props.can(revoke) || busy} />',
      ].join('\n'),
      'x.tsx',
    )

    // The builder writes its own type, so its spread of the draft is data; the row's event takes
    // its type from spreads only, so the one it cannot follow may override it: unread.
    expect(found.props.map(({ asks, question, line }) => ({ asks, question, line }))).toEqual([
      { asks: 'x.create.submit-button', question: true, line: 3 },
      { asks: undefined, question: true, line: 4 },
      { asks: undefined, question: undefined, line: 5 },
    ])
  })
  it('reads an event whose type an anchor constant holds, where its file declares the constant', () => {
    const found = collectFromSource(
      [
        "const REVOKE_TEST_ID = 'x.sessions.revoke-button'",
        "const RESET_TEST_ID = 'x.reset.send-button'",
        "const DIALOG_TEST_ID = 'x.help-dialog'",
        "const CONFIRM_TEST_ID = testIdFor(DIALOG_TEST_ID, 'confirm-button')",
        'const revoke = { type: REVOKE_TEST_ID } as const',
        'const reset = { type: RESET_TEST_ID } as const',
        'const a = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can(revoke)} />',
        'const b = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can(reset)} />',
        "const c = <Button testId={testIdFor(DIALOG_TEST_ID, 'confirm-button')} disabled={!props.can({ type: testIdFor(DIALOG_TEST_ID, 'confirm-button') })} />",
        'const d = <Button testId={CONFIRM_TEST_ID} disabled={!props.can({ type: CONFIRM_TEST_ID })} />',
        'const e = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can({ type: RESET_TEST_ID, ...rest })} />',
      ].join('\n'),
      'x.tsx',
    )

    // b: a constant naming another event asks that one, which the facets check then refuses.
    expect(found.props.map(({ anchor, asks, line }) => ({ anchor, asks, line }))).toEqual([
      { anchor: 'x.sessions.revoke-button', asks: 'x.sessions.revoke-button', line: 7 },
      { anchor: 'x.sessions.revoke-button', asks: 'x.reset.send-button', line: 8 },
      { anchor: 'x.help-dialog.confirm-button', asks: 'x.help-dialog.confirm-button', line: 9 },
      { anchor: 'x.help-dialog.confirm-button', asks: 'x.help-dialog.confirm-button', line: 10 },
      { anchor: 'x.sessions.revoke-button', asks: 'x.reset.send-button', line: 11 },
    ])
    expect(found.problems).toEqual([])
  })
  it('leaves an event unread whose type an anchor constant holds that its file does not declare', () => {
    const found = collectFromSource(
      [
        "import { IMPORTED_TEST_ID } from './anchors'",
        "const REVOKE_TEST_ID = 'x.sessions.revoke-button'",
        'const a = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can({ type: IMPORTED_TEST_ID })} />',
        'const b = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can({ type: MISSING_TEST_ID })} />',
        "const c = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can({ type: testIdFor(IMPORTED_TEST_ID, 'revoke-button') })} />",
        'const d = <Button data-testid={REVOKE_TEST_ID} disabled={!props.can({ type: revokeAnchor })} />',
      ].join('\n'),
      'x.tsx',
    )

    // The question is still one to the machine, about an event the file does not say.
    expect(found.props.map(({ asks, question, line }) => ({ asks, question, line }))).toEqual([
      { asks: undefined, question: true, line: 3 },
      { asks: undefined, question: true, line: 4 },
      { asks: undefined, question: true, line: 5 },
      { asks: undefined, question: true, line: 6 },
    ])
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
