import { parseSync } from 'oxc-parser'
import { describe, expect, it } from 'vitest'

import { IGNORE_MALFORMED, IGNORE_WITHOUT_REASON, ignoreMarkers } from './ignore'

const read = (text: string) =>
  ignoreMarkers(text, parseSync('view.tsx', text, { lang: 'tsx', sourceType: 'module' }).comments)

describe('ignoreMarkers', () => {
  it('reads a marker in JSX children and points at the element after its braces', () => {
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
  it('reads a -self marker written before an element, its reason continued on the next lines', () => {
    const text =
      'const a = (\n  // ui-contract-ignore-self: the button Close\n  //   renders for its caller\n  <Button />\n)'

    expect(read(text).markers).toEqual([
      {
        at: text.indexOf('//'),
        target: text.indexOf('<Button'),
        self: true,
        reason: 'the button Close renders for its caller',
      },
    ])
  })
  it('points a marker that nothing follows at what comes next, for the counter to refuse', () => {
    const text = '<div>\n  {/* ui-contract-ignore: a reason */}\n</div>'

    expect(read(text).markers[0]?.target).toBe(text.indexOf('</div>'))
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
