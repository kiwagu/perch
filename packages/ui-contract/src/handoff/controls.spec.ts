import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { formatProblem } from '../files'
import {
  IGNORE_MALFORMED,
  IGNORE_NO_CONTROL,
  IGNORE_WITHOUT_ELEMENT,
  IGNORE_WITHOUT_REASON,
} from '../sources'

import { countControls } from './controls'

const count = (body: string) =>
  countControls(
    `export const View = (props: Props) => (\n  <div>\n${body}\n  </div>\n)\n`,
    'view.tsx',
  )

const FIXTURES = join(import.meta.dirname, '../__fixtures__/sources')

const NONE = { ignored: [], problems: [] }

describe('countControls', () => {
  it('counts a control that carries an anchor as marked', () => {
    expect(count('<Button data-testid="sample.save-button" onClick={save}>Save</Button>')).toEqual({
      controls: 1,
      marked: 1,
      unmarked: [],
      ...NONE,
    })
  })
  it('lists an unmarked control with its line, its tag and its text', () => {
    expect(count('<p>text</p>\n<a href="/elsewhere">elsewhere</a>')).toEqual({
      controls: 1,
      marked: 0,
      unmarked: [{ line: 4, tag: 'a', label: 'elsewhere' }],
      ...NONE,
    })
  })
  it('names an unmarked control by its aria-label first, by its static text otherwise', () => {
    expect(
      count(
        '<button aria-label="Close" onClick={close}><XIcon /></button>\n<a href="/">Go <b>home</b></a>\n<Button onClick={save}>{t(\'save\')}</Button>\n<Button onClick={save}>{\'Save\'} now</Button>',
      ).unmarked,
    ).toEqual([
      { line: 3, tag: 'button', label: 'Close' },
      { line: 4, tag: 'a', label: 'Go home' },
      { line: 5, tag: 'Button' },
      { line: 6, tag: 'Button', label: 'Save now' },
    ])
  })
  it('takes a testId or a *TestId prop as a mark, whatever its value', () => {
    expect(
      count(
        '<Input testId={props.testId} />\n<OptionSelect triggerTestId="sample.locale-select" />',
      ),
    ).toMatchObject({ controls: 2, marked: 2 })
  })
  it('counts any element with an onClick, and nothing else that is not a control', () => {
    expect(count('<div onClick={open}>open</div>\n<span>label</span>\n<HomeIcon />')).toEqual({
      controls: 1,
      marked: 0,
      unmarked: [{ line: 3, tag: 'div', label: 'open' }],
      ...NONE,
    })
  })
  it('leaves out an element inside a marked control that has no action of its own', () => {
    expect(
      count(
        '<Link to="/" data-testid="sample.home-link">\n<Button size="icon"><HomeIcon /></Button>\n</Link>',
      ),
    ).toEqual({ controls: 1, marked: 1, unmarked: [], ...NONE })
  })
  it('counts an element with its own action inside a marked control on its own', () => {
    expect(
      count('<Button data-testid="sample.open-button">\n<span onClick={close}>x</span>\n</Button>'),
    ).toEqual({
      controls: 2,
      marked: 1,
      unmarked: [{ line: 4, tag: 'span', label: 'x' }],
      ...NONE,
    })
  })
  it('takes a control inside a label as marked', () => {
    expect(count('<label>\nName <input name="name" />\n</label>')).toEqual({
      controls: 1,
      marked: 1,
      unmarked: [],
      ...NONE,
    })
  })
  it('does not count an element that passes on the props it receives', () => {
    expect(
      count('<button type="button" {...props} />\n<Textarea {...rest} />\n<a {...props.link} />'),
    ).toEqual({ controls: 0, marked: 0, unmarked: [], ...NONE })
  })
  it('counts an element whose spread is built by a call, such as a form field', () => {
    expect(
      count(
        "<Input {...field('email')} data-testid=\"sample.email-input\" />\n<Input {...field('name')} />",
      ),
    ).toEqual({ controls: 2, marked: 1, unmarked: [{ line: 4, tag: 'Input' }], ...NONE })
  })
  it('names a member tag in full', () => {
    expect(count('<Dialog.Close onClick={close} />').unmarked).toEqual([
      { line: 3, tag: 'Dialog.Close' },
    ])
  })
  it('refuses a file that does not parse', () => {
    expect(() => countControls('export const A = <div>', 'broken.tsx')).toThrow(/^broken\.tsx:1: /)
  })
})

describe('countControls with coverage-ignore markers', () => {
  const fixture = (name: string) =>
    countControls(readFileSync(join(FIXTURES, name), 'utf8'), `sources/${name}`)
  const ignored = fixture('ignored.tsx')
  const PAGER = 'a decorative pager, no scenario pages through it'
  const CARD = 'the card link is a mouse convenience'
  const HOME = 'the home link is drawn twice, this one for show'
  const NAME = 'the name is typed in the form, not here'
  const CLOSE = 'the button Close renders for its caller'
  const reasoned = (reason: string) => ignored.ignored.filter((entry) => entry.reason === reason)

  it('declares off every control of a subtree, an anchored one included', () => {
    expect(reasoned(PAGER)).toEqual([
      { line: 7, tag: 'a', label: 'first', reason: PAGER },
      { line: 8, tag: 'button', label: 'next', reason: PAGER },
      { line: 11, tag: 'Button', label: 'Save', reason: PAGER },
    ])
  })
  it('declares off only the element of a -self marker, and counts what it holds on its own', () => {
    expect(reasoned(CARD)).toEqual([{ line: 14, tag: 'Link', label: 'Open', reason: CARD }])
    expect(ignored.unmarked).toContainEqual({ line: 15, tag: 'Button', label: 'Open' })
  })
  it('lets an anchored element under a -self marker leave its parts to be counted', () => {
    expect(reasoned(HOME)).toEqual([{ line: 18, tag: 'Link', reason: HOME }])
    expect(ignored.unmarked).toContainEqual({ line: 19, tag: 'Button' })
  })
  it('declares off a control inside a label', () => {
    expect(reasoned(NAME)).toEqual([{ line: 26, tag: 'input', reason: NAME }])
  })
  it('reads a marker written before an element in an attribute', () => {
    expect(reasoned(CLOSE)).toEqual([{ line: 31, tag: 'Button', reason: CLOSE }])
  })
  it('counts an ignored control as neither marked nor unmarked, whatever it carries', () => {
    expect(ignored).toEqual({
      controls: 4,
      marked: 0,
      unmarked: [
        { line: 15, tag: 'Button', label: 'Open' },
        { line: 19, tag: 'Button' },
        { line: 34, tag: 'a', label: 'Go inside' },
        { line: 38, tag: 'button', label: 'Close' },
      ],
      ignored: [
        { line: 7, tag: 'a', label: 'first', reason: PAGER },
        { line: 8, tag: 'button', label: 'next', reason: PAGER },
        { line: 11, tag: 'Button', label: 'Save', reason: PAGER },
        { line: 14, tag: 'Link', label: 'Open', reason: CARD },
        { line: 18, tag: 'Link', reason: HOME },
        { line: 26, tag: 'input', reason: NAME },
        { line: 31, tag: 'Button', reason: CLOSE },
      ],
      problems: [],
    })
  })
  it('refuses a reason on the next comment line, a comment between, and a block comment in code', () => {
    const rejected = fixture('rejected-markers.tsx')

    expect(rejected.problems.map(formatProblem)).toEqual([
      `sources/rejected-markers.tsx:7: ${IGNORE_WITHOUT_REASON}`,
      `sources/rejected-markers.tsx:14: ${IGNORE_WITHOUT_ELEMENT}`,
      `sources/rejected-markers.tsx:19: ${IGNORE_MALFORMED}`,
      `sources/rejected-markers.tsx:20: ${IGNORE_WITHOUT_ELEMENT}`,
    ])
    expect(rejected).toMatchObject({
      controls: 3,
      unmarked: [
        { line: 9, tag: 'Button' },
        { line: 16, tag: 'Button' },
        { line: 19, tag: 'Button' },
      ],
      ignored: [],
    })
  })
  it('reports a marker without a reason and one that no element follows, and applies neither', () => {
    const counted = count(
      '{/* ui-contract-ignore: */}\n<a href="/">home</a>\n<ul>\n{/* ui-contract-ignore: the end */}\n</ul>\n{/* ui-contract-ignore: a list */}\n{items}',
    )

    expect(counted.problems.map(formatProblem)).toEqual([
      `view.tsx:3: ${IGNORE_WITHOUT_REASON}`,
      `view.tsx:6: ${IGNORE_WITHOUT_ELEMENT}`,
      `view.tsx:8: ${IGNORE_WITHOUT_ELEMENT}`,
    ])
    expect(counted).toMatchObject({ controls: 1, unmarked: [{ line: 4, tag: 'a' }], ignored: [] })
  })
  it('reports a marker whose element, and subtree for the plain form, holds no control', () => {
    const counted = count(
      [
        '{/* ui-contract-ignore: a decorative list */}',
        '<ul><li>one</li></ul>',
        '{/* ui-contract-ignore-self: the wrapper alone */}',
        '<div>',
        '<button onClick={go}>go</button>',
        '</div>',
        '{/* ui-contract-ignore: whoever renders it decides */}',
        '<button {...props} />',
        '{/* ui-contract-ignore: a decorative pager */}',
        '<nav><a href="/first">first</a></nav>',
      ].join('\n'),
    )

    expect(counted.problems.map(formatProblem)).toEqual([
      `view.tsx:3: ${IGNORE_NO_CONTROL}`,
      `view.tsx:5: ${IGNORE_NO_CONTROL}`,
      `view.tsx:9: ${IGNORE_NO_CONTROL}`,
    ])
    expect(counted).toMatchObject({
      controls: 1,
      unmarked: [{ line: 7, tag: 'button', label: 'go' }],
      ignored: [{ line: 12, tag: 'a', label: 'first', reason: 'a decorative pager' }],
    })
  })
})
