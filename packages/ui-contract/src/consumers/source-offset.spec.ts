import { describe, expect, it } from 'vitest'

import { sourceOffset } from './source-offset'

describe('sourceOffset', () => {
  it('finds a plain character where it is written', () => {
    expect(sourceOffset("const s = 'abc'", 11, 2)).toBe(13)
  })
  it('counts an escape as the one character it cooks to', () => {
    const source = String.raw`'\n\x41\u0041\'z'`

    expect(sourceOffset(source, 1, 4)).toBe(source.indexOf('z'))
  })
  it('counts a code point escape beyond the basic plane as the two characters it cooks to', () => {
    const source = String.raw`'\u{1F600}z'`

    expect(sourceOffset(source, 1, 2)).toBe(source.indexOf('z'))
  })
  it('passes over a line continuation, which cooks to nothing', () => {
    const lineFeed = "'a\\\nz'"
    const crLf = '`a\\\r\nz`'

    expect(sourceOffset(lineFeed, 1, 1)).toBe(lineFeed.indexOf('z'))
    expect(sourceOffset(crLf, 1, 1)).toBe(crLf.indexOf('z'))
  })
  it('counts a CR LF of a template as the one line feed it cooks to', () => {
    const source = '`a\r\nz`'

    expect(sourceOffset(source, 1, 2)).toBe(source.indexOf('z'))
  })
})
