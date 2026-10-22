import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { IGNORE_MALFORMED, IGNORE_WITHOUT_REASON, ignoreMarkers } from './ignore'

const read = (text: string) =>
  ignoreMarkers(text, parseSync('view.tsx', text, { lang: 'tsx', sourceType: 'module' }))

describe('ignoreMarkers', () => {
  it('reads a marker in a JSX comment container and points at the element after its braces', () => {
    const text = '<div>\n  {/* ui-contract-ignore: a decorative pager */}\n  <nav />\n</div>'

    expect(read(text)).toEqual({
      markers: [
        {
          at: text.indexOf('/*'),
          target: text.indexOf('<nav'),
          self: false,
          reason: 'a decorative pager',
        },
      ],
      faults: [],
    })
  })
  it('reads a -self line comment written before an element in code', () => {
    const text =
      'const a = (\n  // ui-contract-ignore-self: the button Close renders\n  <Button />\n)'

    expect(read(text).markers).toEqual([
      {
        at: text.indexOf('//'),
        target: text.indexOf('<Button'),
        self: true,
        reason: 'the button Close renders',
      },
    ])
  })
  it('takes the reason from the marker alone, never from a comment line after it', () => {
    const text = 'const a = (\n  // ui-contract-ignore:\n  // some explanation\n  <Button />\n)'

    expect(read(text)).toEqual({
      markers: [],
      faults: [{ at: text.indexOf('//'), message: IGNORE_WITHOUT_REASON }],
    })
  })
  it('points a marker followed by another comment at that comment, for the counter to refuse', () => {
    const text =
      'const a = (\n  // ui-contract-ignore: a reason\n  // some explanation\n  <Button />\n)'

    expect(read(text).markers[0]?.target).toBe(text.indexOf('// some'))
  })
  it('points a marker that nothing follows at what comes next, for the counter to refuse', () => {
    const text = '<div>\n  {/* ui-contract-ignore: a reason */}\n</div>'

    expect(read(text).markers[0]?.target).toBe(text.indexOf('</div>'))
  })
  it('refuses a block comment outside a JSX comment container', () => {
    const text =
      'const a = (\n  /* ui-contract-ignore: a reason */\n  <Close render={/* ui-contract-ignore-self: a reason */ <Button />} />\n)'

    expect(read(text)).toEqual({
      markers: [],
      faults: [
        { at: text.indexOf('/*'), message: IGNORE_MALFORMED },
        { at: text.lastIndexOf('/*'), message: IGNORE_MALFORMED },
      ],
    })
  })
  it('refuses a JSX comment container that holds more than the marker', () => {
    const text = '<div>\n{/* a note */ /* ui-contract-ignore: a reason */}\n<nav />\n</div>'

    expect(read(text).faults).toEqual([{ at: text.lastIndexOf('/*'), message: IGNORE_MALFORMED }])
  })
  it('refuses a marker without a reason of three characters, and does not keep it', () => {
    const text =
      '<div>\n{/* ui-contract-ignore: */}\n<a />\n{/* ui-contract-ignore-self: ok */}\n<b />\n</div>'

    expect(read(text)).toEqual({
      markers: [],
      faults: [
        { at: text.indexOf('/*'), message: IGNORE_WITHOUT_REASON },
        { at: text.lastIndexOf('/*'), message: IGNORE_WITHOUT_REASON },
      ],
    })
  })
  it('refuses a comment that starts like a marker and is neither form', () => {
    const text = '<div>\n{/* ui-contract-ignore the pager */}\n<nav />\n</div>'

    expect(read(text)).toEqual({
      markers: [],
      faults: [{ at: text.indexOf('/*'), message: IGNORE_MALFORMED }],
    })
  })
  it('leaves every other comment alone', () => {
    const text =
      '// a note on ui-contract-ignore: not a marker\n<div>\n{/* biome-ignore lint: a reason */}\n<a />\n</div>'

    expect(read(text)).toEqual({ markers: [], faults: [] })
  })
})
