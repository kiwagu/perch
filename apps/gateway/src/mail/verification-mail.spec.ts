import { describe, expect, it } from 'vitest'

import { verificationMail } from './verification-mail'

const LINK = 'https://localhost:5443/verify-email?token=a.b.c'

describe('verificationMail', () => {
  it('writes the mail in English with the link in its text and its button', () => {
    const mail = verificationMail({ to: 'ann@example.test', name: 'Ann', link: LINK, locale: 'en' })

    expect(mail.to).toBe('ann@example.test')
    expect(mail.subject).toBe('Confirm your email for Perch')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(`\n\n${LINK}\n\n`)
    expect(mail.html).toContain('<html lang="en">')
    expect(mail.html).toContain(`<a href="${LINK}">Confirm my email</a>`)
  })
  it('writes it in Spanish for an account that speaks Spanish', () => {
    const mail = verificationMail({ to: 'ann@example.test', name: 'Ann', link: LINK, locale: 'es' })

    expect(mail.subject).toBe('Confirma tu correo para Perch')
    expect(mail.html).toContain('<html lang="es">')
  })
  it('escapes the name in the HTML and keeps it as typed in the text', () => {
    const mail = verificationMail({
      to: 'ann@example.test',
      name: '<script>alert(1)</script>',
      link: LINK,
      locale: 'en',
    })

    expect(mail.html).not.toContain('<script>')
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(mail.text).toContain('Hello <script>alert(1)</script>,')
  })
})
