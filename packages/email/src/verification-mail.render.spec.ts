import { describe, expect, it } from 'vitest'

import { rootLanguage, UNSUBSTITUTED } from './__fixtures__/mail-reading'
import { anchorsOf, elementsNamed, textOf } from './html'
import { renderVerificationMail } from './verification-mail.render'

const LINK = 'https://localhost:5443/verify-email?token=a.b.c'

/** A recognisable address, name and link: none may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const ADDRESS = `${MARKER}@example.test`

const written = (overrides: { name?: string; link?: string; locale?: string } = {}) =>
  renderVerificationMail({ to: ADDRESS, name: 'Ann', link: LINK, locale: 'en', ...overrides })

describe('renderVerificationMail', () => {
  it('writes the mail in English: to the account, its subject, the root language, the greeting', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(ADDRESS)
    expect(mail.subject).toBe('Confirm your email for Perch')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(ADDRESS)
  })
  it('writes it in Spanish for an account that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Confirma tu correo para Perch')
    expect(rootLanguage(mail.html)).toBe('es')
    expect(mail.text).toContain('Hola, Ann:')
  })
  it.each(['en', 'es'])('leaves no catalog parameter unsubstituted in %s', async (locale) => {
    const mail = (await written({ locale }))._unsafeUnwrap()

    expect(mail.html).not.toMatch(UNSUBSTITUTED)
    expect(mail.text).not.toMatch(UNSUBSTITUTED)
  })
  it('puts the link behind the button and once more as the raw link, and into the text', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(anchorsOf(mail.html)).toStrictEqual([
      { href: LINK, text: 'Confirm my email', action: 'primary' },
      { href: LINK, text: LINK, action: undefined },
    ])
    expect(mail.text).toContain(LINK)
  })
  it('writes the HTML minified, with no line breaks between its tags', async () => {
    const { html } = (await written())._unsafeUnwrap()

    expect(html).not.toMatch(/>\s*\n\s*</)
  })
  it('writes a name of markup and quotes as text, nothing of it executable', async () => {
    const name = `<script>alert("x")</script>" onload="alert(1)`
    const mail = (await written({ name }))._unsafeUnwrap()

    expect(elementsNamed(mail.html, 'script')).toEqual([])
    expect(mail.html).not.toContain('<script>')
    expect(elementsNamed(mail.html, 'p').some((p) => textOf(p).includes(`Hello ${name},`))).toBe(
      true,
    )
    expect(mail.text).toContain(`Hello ${name},`)
  })
  it('keeps a link of quotes and ampersands whole in its attribute and in the text', async () => {
    const link = `https://localhost:5443/verify-email?token=a"b'c&d<e>`
    const mail = (await written({ link }))._unsafeUnwrap()

    expect(anchorsOf(mail.html).map(({ href }) => href)).toEqual([link, link])
    expect(mail.text).toContain(link)
  })
  it('writes a link on http too', async () => {
    const link = 'http://127.0.0.1:5173/verify-email?token=a.b.c'

    expect(anchorsOf((await written({ link }))._unsafeUnwrap().html)[0]?.href).toBe(link)
  })
  it.each(['fr', 'EN', 'es-AR', '', '@@', 'en_US!!'])(
    'writes no mail in %j, a language the mails are not written in, and names nothing of it',
    async (locale) => {
      const error = (await written({ locale, name: MARKER }))._unsafeUnwrapErr()

      expect(error).toStrictEqual({
        code: 'mail:LOCALE_UNSUPPORTED',
        message: 'the mail was asked in a language the mails are not written in',
      })
    },
  )
  // Each case by a fixed label: a test report prints its title, and a link may carry a token.
  it.each([
    ['a script', 'javascript:alert(1)'],
    ['a script in mixed case', 'JavaScript:alert(1)'],
    ['a data address', 'data:text/html,<script>alert(1)</script>'],
    ['a mail address', 'mailto:ann@example.test'],
    ['an ftp address', 'ftp://example.test/verify-email?token=a.b.c'],
    ['a path without an origin', '/verify-email?token=a.b.c'],
    ['no address at all', 'not a link'],
    ['empty', ''],
  ])(
    'writes no mail whose link is %s, which is not an http or https address, and names nothing of it',
    async (_label, link) => {
      const error = (await written({ link, name: MARKER }))._unsafeUnwrapErr()

      expect(error).toStrictEqual({
        code: 'mail:LINK_INVALID',
        message: 'the link of the mail is not an http or https address',
      })
    },
  )
})
