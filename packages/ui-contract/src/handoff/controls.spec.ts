import { describe, expect, it } from 'vitest'

import { countControls } from './controls'

const count = (body: string) =>
  countControls(
    `export const View = (props: Props) => (\n  <div>\n${body}\n  </div>\n)\n`,
    'view.tsx',
  )

describe('countControls', () => {
  it('counts a control that carries an anchor as marked', () => {
    expect(count('<Button data-testid="sample.save-button" onClick={save}>Save</Button>')).toEqual({
      controls: 1,
      marked: 1,
      unmarked: [],
    })
  })
  it('lists an unmarked control with its line and tag', () => {
    expect(count('<p>text</p>\n<a href="/elsewhere">elsewhere</a>')).toEqual({
      controls: 1,
      marked: 0,
      unmarked: [{ line: 4, tag: 'a' }],
    })
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
      unmarked: [{ line: 3, tag: 'div' }],
    })
  })
  it('leaves out an element inside a marked control that has no action of its own', () => {
    expect(
      count(
        '<Link to="/" data-testid="sample.home-link">\n<Button size="icon"><HomeIcon /></Button>\n</Link>',
      ),
    ).toEqual({ controls: 1, marked: 1, unmarked: [] })
  })
  it('counts an element with its own action inside a marked control on its own', () => {
    expect(
      count('<Button data-testid="sample.open-button">\n<span onClick={close}>x</span>\n</Button>'),
    ).toEqual({ controls: 2, marked: 1, unmarked: [{ line: 4, tag: 'span' }] })
  })
  it('takes a control inside a label as marked', () => {
    expect(count('<label>\nName <input name="name" />\n</label>')).toEqual({
      controls: 1,
      marked: 1,
      unmarked: [],
    })
  })
  it('does not count an element that passes on the props it receives', () => {
    expect(
      count('<button type="button" {...props} />\n<Textarea {...rest} />\n<a {...props.link} />'),
    ).toEqual({ controls: 0, marked: 0, unmarked: [] })
  })
  it('counts an element whose spread is built by a call, such as a form field', () => {
    expect(
      count(
        "<Input {...field('email')} data-testid=\"sample.email-input\" />\n<Input {...field('name')} />",
      ),
    ).toEqual({ controls: 2, marked: 1, unmarked: [{ line: 4, tag: 'Input' }] })
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
