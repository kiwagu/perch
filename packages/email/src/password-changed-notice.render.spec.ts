import { describe, expect, it } from 'vitest'

import {
  NOT_HTTP_LINKS,
  rootLanguage,
  UNSUBSTITUTED,
  UNSUPPORTED_LOCALES,
} from './__fixtures__/mail-reading'
import { anchorsOf } from './html'
import { renderPasswordChangedNotice } from './password-changed-notice.render'

const LINK = 'https://localhost:5443/forgot-password'

/** A recognisable address and name: neither may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const ADDRESS = `${MARKER}@example.test`

const written = (overrides: { name?: string; link?: string; locale?: string } = {}) =>
  renderPasswordChangedNotice({ to: ADDRESS, name: 'Ann', link: LINK, locale: 'en', ...overrides })

describe('renderPasswordChangedNotice', () => {
  it('writes the notice in English: to the account, its subject, the root language, the greeting', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(ADDRESS)
    expect(mail.subject).toBe('Your Perch password was changed')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain("If it wasn't you, set a new password now:")
    expect(mail.text).toContain('If it was you, there is nothing to do.')
  })
  it('writes it in Spanish for an account that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Tu contraseña de Perch cambió')
    expect(rootLanguage(mail.html)).toBe('es')
    expect(mail.text).toContain('Hola, Ann:')
  })
  it.each(['en', 'es'])('leaves no catalog parameter unsubstituted in %s', async (locale) => {
    const mail = (await written({ locale }))._unsafeUnwrap()

    expect(mail.html).not.toMatch(UNSUBSTITUTED)
    expect(mail.text).not.toMatch(UNSUBSTITUTED)
  })
  it('leads its button and its raw link to asking for a new password, with no token', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(anchorsOf(mail.html)).toStrictEqual([
      { href: LINK, text: 'Set a new password', action: 'primary' },
      { href: LINK, text: LINK, action: undefined },
    ])
    expect(mail.text).toContain(LINK)
  })
  it.each(UNSUPPORTED_LOCALES)(
    'writes no notice in %j, a language the mails are not written in',
    async (locale) => {
      expect((await written({ locale }))._unsafeUnwrapErr().code).toBe('mail:LOCALE_UNSUPPORTED')
    },
  )
  it.each(NOT_HTTP_LINKS)(
    'writes no notice whose link is %s, and names nothing of it',
    async (_label, link) => {
      const error = (await written({ link, name: MARKER }))._unsafeUnwrapErr()

      expect(error.code).toBe('mail:LINK_INVALID')
      expect(JSON.stringify(error)).not.toContain(MARKER)
    },
  )
})
