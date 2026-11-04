import { describe, expect, it } from 'vitest'

import {
  NOT_HTTP_LINKS,
  rootLanguage,
  UNSUBSTITUTED,
  UNSUPPORTED_LOCALES,
} from './__fixtures__/mail-reading'
import { anchorsOf } from './html'
import { renderResetPasswordMail } from './reset-password-mail.render'

const LINK = 'https://localhost:5443/reset-password?token=reset-token-0123456789abcdef'

/** A recognisable address and name: neither may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const ADDRESS = `${MARKER}@example.test`

const written = (overrides: { name?: string; link?: string; locale?: string } = {}) =>
  renderResetPasswordMail({ to: ADDRESS, name: 'Ann', link: LINK, locale: 'en', ...overrides })

describe('renderResetPasswordMail', () => {
  it('writes the mail in English: to the account, its subject, the root language, the greeting', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(ADDRESS)
    expect(mail.subject).toBe('Set a new password for Perch')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(ADDRESS)
    expect(mail.text).toContain('The link works for one hour')
  })
  it('writes it in Spanish for an account that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Elige una contraseña nueva para Perch')
    expect(rootLanguage(mail.html)).toBe('es')
    expect(mail.text).toContain('Hola, Ann:')
    expect(mail.text).toContain('El enlace sirve durante una hora')
  })
  it.each(['en', 'es'])('leaves no catalog parameter unsubstituted in %s', async (locale) => {
    const mail = (await written({ locale }))._unsafeUnwrap()

    expect(mail.html).not.toMatch(UNSUBSTITUTED)
    expect(mail.text).not.toMatch(UNSUBSTITUTED)
  })
  it('puts the link behind the button and once more as the raw link, and into the text', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(anchorsOf(mail.html)).toStrictEqual([
      { href: LINK, text: 'Set a new password', action: 'primary' },
      { href: LINK, text: LINK, action: undefined },
    ])
    expect(mail.text).toContain(LINK)
    expect(mail.html).not.toMatch(/>\s*\n\s*</)
  })
  it.each(UNSUPPORTED_LOCALES)(
    'writes no mail in %j, a language the mails are not written in',
    async (locale) => {
      expect((await written({ locale, name: MARKER }))._unsafeUnwrapErr().code).toBe(
        'mail:LOCALE_UNSUPPORTED',
      )
    },
  )
  it.each(NOT_HTTP_LINKS)(
    'writes no mail whose link is %s, and names nothing of it',
    async (_label, link) => {
      const error = (await written({ link, name: MARKER }))._unsafeUnwrapErr()

      expect(error.code).toBe('mail:LINK_INVALID')
      expect(JSON.stringify(error)).not.toContain(MARKER)
    },
  )
})
