import { describe, expect, it } from 'vitest'

import { anchorsOf, elementsNamed, textOf } from './html'

const HTML =
  '<!DOCTYPE html><html><body><p>Hi <b>there</b></p>' +
  '<a href="https://x.test/?a=1&amp;b=&quot;2&quot;"><span>Open</span> <span>it</span></a>' +
  '<table><tr><td><a href="https://y.test">https://y.test</a></td></tr></table>' +
  '<a name="top">Top</a></body></html>'

describe('html', () => {
  it('finds the elements of a tag as a parser builds them, and reads their text', () => {
    expect(elementsNamed(HTML, 'p').map(textOf)).toEqual(['Hi there'])
    expect(elementsNamed(HTML, 'script')).toEqual([])
  })
  it('reads each anchor with an href in order, its href and its text as a parser reads them', () => {
    expect(anchorsOf(HTML)).toEqual([
      { href: 'https://x.test/?a=1&b="2"', text: 'Open it' },
      { href: 'https://y.test', text: 'https://y.test' },
    ])
  })
})
