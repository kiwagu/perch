import { describe, expect, it } from 'vitest'

import {
  NOT_HTTP_LINKS,
  rootLanguage,
  UNSUBSTITUTED,
  UNSUPPORTED_LOCALES,
} from './__fixtures__/mail-reading'
import { anchorsOf, elementsNamed } from './html'
import { renderInvitationMail } from './invitation-mail.render'

const LINK = 'https://localhost:5443/invitation?token=eyJhbG...NiJ9.e30.c2ln'

/** A recognisable address and organisation name: neither may reach an error. */
const MARKER = `marker-${crypto.randomUUID()}`
const ADDRESS = `${MARKER}@example.test`

const written = (
  overrides: {
    organisation?: string
    role?: 'member' | 'admin'
    link?: string
    locale?: string
  } = {},
) =>
  renderInvitationMail({
    to: ADDRESS,
    organisation: 'Acme Robotics',
    role: 'member',
    link: LINK,
    locale: 'en',
    ...overrides,
  })

describe('renderInvitationMail', () => {
  it('writes the mail in English to the invited email: its subject, the root language, a greeting with no name, the organisation, the role, how long the link works and what happens without it', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.to).toBe(ADDRESS)
    expect(mail.subject).toBe('You are invited to join an organisation on Perch')
    expect(rootLanguage(mail.html)).toBe('en')
    expect(mail.text).toContain('Hello,')
    expect(mail.text).toContain('Acme Robotics')
    expect(mail.text).toContain('as a member')
    expect(mail.text).toContain('The link works once and for seven days')
    expect(mail.text).toContain('nothing happens without the link')
  })
  it('writes it in Spanish for a recipient that speaks Spanish', async () => {
    const mail = (await written({ locale: 'es' }))._unsafeUnwrap()

    expect(mail.subject).toBe('Te invitaron a unirte a una organización en Perch')
    expect(rootLanguage(mail.html)).toBe('es')
    expect(mail.text).toContain('Hola:')
    expect(mail.text).toContain('Acme Robotics')
    expect(mail.text).toContain('como miembro')
    expect(mail.text).toContain('El enlace sirve una sola vez y durante siete días')
  })
  it.each([
    ['en', 'admin', 'as an admin'],
    ['en', 'member', 'as a member'],
    ['es', 'admin', 'como administrador'],
    ['es', 'member', 'como miembro'],
  ] as const)('says the role in %s: %s is %j', async (locale, role, words) => {
    const mail = (await written({ locale, role }))._unsafeUnwrap()

    expect(mail.text).toContain(words)
  })
  it.each(['en', 'es'])('leaves no catalog parameter unsubstituted in %s', async (locale) => {
    const mail = (await written({ locale }))._unsafeUnwrap()

    expect(mail.html).not.toMatch(UNSUBSTITUTED)
    expect(mail.text).not.toMatch(UNSUBSTITUTED)
  })
  it('puts the link behind the button and once more as the raw link, and into the text', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(anchorsOf(mail.html)).toStrictEqual([
      { href: LINK, text: 'See the invitation', action: 'primary' },
      { href: LINK, text: LINK, action: undefined },
    ])
    expect(mail.text).toContain(LINK)
  })
  it("writes the organisation's name as text, never as markup or as a catalog parameter", async () => {
    const organisation = '<script>alert("x")</script><b>{role}</b>'
    const mail = (await written({ organisation }))._unsafeUnwrap()

    expect(elementsNamed(mail.html, 'script')).toEqual([])
    expect(elementsNamed(mail.html, 'b')).toEqual([])
    expect(mail.html).not.toContain('<script>')
    expect(mail.text).toContain('{role}')
  })
  it('greets no one by name and names no address: the recipient may have no account', async () => {
    const mail = (await written())._unsafeUnwrap()

    expect(mail.text).toContain('Hello,')
    expect(mail.text).not.toContain(MARKER)
    expect(mail.html).not.toContain(MARKER)
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
      const error = (await written({ link, organisation: MARKER }))._unsafeUnwrapErr()

      expect(error.code).toBe('mail:LINK_INVALID')
      expect(JSON.stringify(error)).not.toContain(MARKER)
    },
  )
})
