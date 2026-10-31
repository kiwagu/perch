import { describe, expect, it } from 'vitest'

import { escapeHtml } from './html'

describe('escapeHtml', () => {
  it('writes the five characters HTML gives a meaning as entities, and leaves the rest', () => {
    expect(escapeHtml(`<a href="x">Tom & 'Jerry'</a> ñ`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt; ñ',
    )
  })
})
