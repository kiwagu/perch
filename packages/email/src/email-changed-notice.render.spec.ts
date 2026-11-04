import { describe, expect, it } from 'vitest'

import { rootLanguage, UNSUBSTITUTED, UNSUPPORTED_LOCALES } from './__fixtures__/mail-reading'
import { renderEmailChangedNotice } from './email-changed-notice.render'
import { anchorsOf } from './html'

/** A recognisable old address and name: neither may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const OLD_ADDRESS = `${MARKER}@example.test`

const written = (overrides: { name?: string; locale?: string } = {}) =>
  renderEmailChangedNotice({ to: OLD_ADDRESS, name: 'Ann', locale: 'en', ...overrides })

describe('renderEmailChangedNotice', () => {
  it('writes the notice in English to the old address: its subject, the root language, the greeting', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(OLD_ADDRESS)
    expect(mail.subject).toBe('Your Perch account has a new email')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(`${OLD_ADDRESS} is no longer the email of your Perch account`)
  })
  it('writes it in Spanish for an account that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Tu cuenta de Perch tiene un nuevo correo')
    expect(rootLanguage(mail.html)).toBe('es')
    expect(mail.text).toContain('Hola, Ann:')
  })
  it.each(['en', 'es'])(
    'leaves no catalog parameter unsubstituted in %s, and carries no link at all',
    async (locale) => {
      const mail = (await written({ locale }))._unsafeUnwrap()

      expect(mail.html).not.toMatch(UNSUBSTITUTED)
      expect(mail.text).not.toMatch(UNSUBSTITUTED)
      expect(anchorsOf(mail.html)).toEqual([])
      expect(mail.text).not.toMatch(/https?:|:\/\//i)
    },
  )
  it.each(UNSUPPORTED_LOCALES)(
    'writes no notice in %j, a language the mails are not written in, naming nothing of it',
    async (locale) => {
      const error = (await written({ locale, name: MARKER }))._unsafeUnwrapErr()

      expect(error.code).toBe('mail:LOCALE_UNSUPPORTED')
      expect(JSON.stringify(error)).not.toContain(MARKER)
    },
  )
})
