import { describe, expect, it } from 'vitest'

import { expectNoLeak, LEAK, thrown } from './__fixtures__/leak'
import { firstLink, linkToken } from './mail-link'

const mail = (text: string) => ({ id: 'a', subject: 's', text, html: '', to: [] })

describe('firstLink and linkToken', () => {
  it('reads the first http(s) link of the text, and its token', () => {
    const link = firstLink(
      mail('Hello\n\nhttps://localhost:5493/verify-email?token=a.b.c\n\nBye https://x.test'),
    )

    expect(link).toBe('https://localhost:5493/verify-email?token=a.b.c')
    expect(linkToken(link)).toBe('a.b.c')
  })
  it('fails on a mail without a link, and on a link without a token', () => {
    expect(() => firstLink(mail('no link'))).toThrow()
    expect(() => linkToken('https://localhost:5493/me')).toThrow()
  })
  it('fail with nothing of the mail or the link', () => {
    expectNoLeak(thrown(() => firstLink({ ...mail('no link'), subject: `Welcome, ${LEAK}` })))
    expectNoLeak(thrown(() => linkToken(`https://localhost:5493/${LEAK}`)))
    expectNoLeak(thrown(() => linkToken(`not a link ${LEAK}`)))
  })
})
