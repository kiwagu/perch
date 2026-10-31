import { describe, expect, it } from 'vitest'

import { verificationMail } from './verification-mail'

const LINK = 'https://localhost:5443/verify-email?token=a.b.c'

describe('verificationMail', () => {
  it('writes the mail in English with the link in its text and its button', () => {
    const mail = verificationMail({
      to: 'ann@example.test',
      name: 'Ann',
      link: LINK,
      locale: 'en',
    })._unsafeUnwrap()

    expect(mail.to).toBe('ann@example.test')
    expect(mail.subject).toBe('Confirm your email for Perch')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(`\n\n${LINK}\n\n`)
    expect(mail.html).toContain('<html lang="en">')
    expect(mail.html).toContain(`<a href="${LINK}">Confirm my email</a>`)
  })
  it('writes it in Spanish for an account that speaks Spanish', () => {
    const mail = verificationMail({
      to: 'ann@example.test',
      name: 'Ann',
      link: LINK,
      locale: 'es',
    })._unsafeUnwrap()

    expect(mail.subject).toBe('Confirma tu correo para Perch')
    expect(mail.html).toContain('<html lang="es">')
  })
  it('escapes the name in the HTML and keeps it as typed in the text', () => {
    const mail = verificationMail({
      to: 'ann@example.test',
      name: '<script>alert(1)</script>',
      link: LINK,
      locale: 'en',
    })._unsafeUnwrap()

    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.text).toContain('Hello <script>alert(1)</script>,')
  })
  it('escapes the quotes and ampersands of a link inside its attribute, and keeps it as is in the text', () => {
    const link = `https://localhost:5443/verify-email?token=a"b'c&d<e>`
    const mail = verificationMail({
      to: 'ann@example.test',
      name: 'Ann',
      link,
      locale: 'en',
    })._unsafeUnwrap()

    expect(mail.html).toContain(
      '<a href="https://localhost:5443/verify-email?token=a&quot;b&#39;c&amp;d&lt;e&gt;">Confirm my email</a>',
    )
    expect(mail.text).toContain(`\n\n${link}\n\n`)
  })
  it('writes a link on http too', () => {
    const link = 'http://127.0.0.1:5173/verify-email?token=a.b.c'

    expect(
      verificationMail({ to: 'ann@example.test', name: 'Ann', link, locale: 'en' })._unsafeUnwrap()
        .html,
    ).toContain(`<a href="${link}">`)
  })
  it.each(['fr', 'EN', 'es-AR', '', '@@', 'en_US!!'])(
    'writes no mail in %j, a language the mails are not written in, and names nothing of it',
    (locale) => {
      const written = verificationMail({ to: 'ann@example.test', name: 'Ann', link: LINK, locale })

      expect(written._unsafeUnwrapErr()).toStrictEqual({
        code: 'mail:LOCALE_UNSUPPORTED',
        message: 'the mail was asked in a language the mails are not written in',
      })
    },
  )
  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:ann@example.test',
    'ftp://example.test/verify-email?token=a.b.c',
    '/verify-email?token=a.b.c',
    'not a link',
    '',
  ])(
    'writes no mail whose link is %j, which is not an http or https address, and names nothing of it',
    (link) => {
      const written = verificationMail({ to: 'ann@example.test', name: 'Ann', link, locale: 'en' })

      expect(written._unsafeUnwrapErr()).toStrictEqual({
        code: 'mail:LINK_INVALID',
        message: 'the link of the mail is not an http or https address',
      })
    },
  )
})
