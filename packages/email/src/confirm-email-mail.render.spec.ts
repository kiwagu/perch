import { describe, expect, it } from 'vitest'

import {
  NOT_HTTP_LINKS,
  rootLanguage,
  UNSUBSTITUTED,
  UNSUPPORTED_LOCALES,
} from './__fixtures__/mail-reading'
import { renderConfirmEmailMail } from './confirm-email-mail.render'
import { anchorsOf } from './html'

const LINK = 'https://localhost:5443/confirm-email?token=eyJhbGciOiJIUzI1NiJ9.e30.c2ln'

/** A recognisable new address and name: neither may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const NEW_ADDRESS = `${MARKER}@example.test`

const written = (overrides: { name?: string; link?: string; locale?: string } = {}) =>
  renderConfirmEmailMail({ to: NEW_ADDRESS, name: 'Ann', link: LINK, locale: 'en', ...overrides })

describe('renderConfirmEmailMail', () => {
  it('writes the mail in English to the new email, naming it: its subject, the root language, the greeting', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(NEW_ADDRESS)
    expect(mail.subject).toBe('Confirm your new email for Perch')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello Ann,')
    expect(mail.text).toContain(`make ${NEW_ADDRESS} the email of your Perch account`)
    expect(mail.text).toContain('The link works for 24 hours')
  })
  it('writes it in Spanish for an account that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Confirma tu nuevo correo para Perch')
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
      { href: LINK, text: 'Confirm my new email', action: 'primary' },
      { href: LINK, text: LINK, action: undefined },
    ])
    expect(mail.text).toContain(LINK)
  })
  it.each(UNSUPPORTED_LOCALES)(
    'writes no mail in %j, a language the mails are not written in',
    async (locale) => {
      expect((await written({ locale }))._unsafeUnwrapErr().code).toBe('mail:LOCALE_UNSUPPORTED')
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
