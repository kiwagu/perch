import { describe, expect, it } from 'vitest'

import { oneDecimal, tableLine } from './table'

describe('tableLine', () => {
  it('pads each cell to the width of its column header and separates them by two spaces', () => {
    expect(tableLine(['devices', 'ms'], ['20', '1.5'])).toBe('20       1.5')
  })

  it('leaves a cell wider than its header as it is', () => {
    expect(tableLine(['n', 'ms'], ['1234', '5'])).toBe('1234  5 ')
  })
})

describe('oneDecimal', () => {
  it('prints one decimal and a dash for what is not a number', () => {
    expect(oneDecimal(12.34)).toBe('12.3')
    expect(oneDecimal(3)).toBe('3.0')
    expect(oneDecimal(Number.NaN)).toBe('-')
  })
})
