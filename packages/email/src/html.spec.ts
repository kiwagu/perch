import { describe, expect, it } from 'vitest'

import { anchorsOf, elementsNamed, textOf } from './html'

const HTML =
  '<!DOCTYPE html><html><body><p>Hi <b>there</b></p>' +
  '<a href="https://x.test/?a=1&amp;b=&quot;2&quot;" data-mail-action="primary"><span>Open</span> <span>it</span></a>' +
  '<table><tr><td><a href="https://y.test">https://y.test</a></td></tr></table>' +
  '<a name="top">Top</a></body></html>'

describe('html', () => {
  it('finds the elements of a tag as a parser builds them, and reads their text', () => {
    expect(elementsNamed(HTML, 'p').map(textOf)).toEqual(['Hi there'])
    expect(elementsNamed(HTML, 'script')).toEqual([])
  })
  it('reads each anchor in order: its href as a parser decodes it, its text and its action mark', () => {
    expect(anchorsOf(HTML)).toStrictEqual([
      { href: 'https://x.test/?a=1&b="2"', text: 'Open it', action: 'primary' },
      { href: 'https://y.test', text: 'https://y.test', action: undefined },
      { href: undefined, text: 'Top', action: undefined },
    ])
  })
})
