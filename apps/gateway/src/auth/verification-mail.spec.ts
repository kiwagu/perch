import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { identityIdFactory } from '@workspace/ids'

import { DIRECTORY, NAMESPACE } from '../config'
import type { MailPort } from '../mail'
import { Outbox } from '../mail/__fixtures__/outbox'

import settingsLocaleStatement from './__fixtures__/settings-locale.surql'
import type { AuthLog } from './auth-log'
import { verificationLink, verificationMailer } from './verification-mail'

const opened: LocalDb[] = []

afterEach(async () => {
  for (const local of opened.splice(0)) {
    await local.close()
  }
})

/** A recognisable address and token: neither may reach a log line. */
const ADDRESS = 'ann@example.test'
const TOKEN = 'tok_MARKER_0123'

interface MailerOptions {
  /** The read of the account's settings fails. */
  readonly settingsFail?: boolean
  /** The mail port, an outbox unless named. */
  readonly mail?: MailPort
  /** The front's origin, `https://localhost:5443` unless named. */
  readonly publicUrl?: string
}

async function mailer(options: MailerOptions = {}) {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()
  const outbox = new Outbox()
  const lines: Array<{ code: string; message: string }> = []
  const log: AuthLog = {
    error: ({ code }, message) => lines.push({ code, message }),
    warn: ({ code }, message) => lines.push({ code, message }),
  }
  const directory = options.settingsFail
    ? interceptQueries(local, (text) => {
        if (text.includes('FROM ONLY settings')) {
          throw new Error(`the directory is down for ${ADDRESS}`)
        }
      })
    : local

  opened.push(local)

  return {
    local,
    outbox,
    lines,
    codes: () => lines.map(({ code }) => code),
    send: verificationMailer({
      mail: options.mail ?? outbox,
      directory,
      publicUrl: options.publicUrl ?? 'https://localhost:5443',
      log,
    }),
  }
}

const user = (locale: string) => ({
  id: identityIdFactory.create(),
  email: ADDRESS,
  name: 'Ann',
  locale,
})

/** Lets the mail that was started, and not awaited, run to its end. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 50))

describe('verificationMailer', () => {
  it("starts the mail and returns before it is sent, linking to the front's /verify-email", async () => {
    const { outbox, send } = await mailer()

    await send({ user: user('en'), token: 'a.b.c' })

    expect(outbox.sent).toEqual([])

    const mail = await outbox.next(ADDRESS)

    expect(mail.text).toContain('https://localhost:5443/verify-email?token=a.b.c')
    expect(mail.subject).toBe('Confirm your email for Perch')
  })

  it('writes in the language the account signed up in while it has no settings', async () => {
    const { outbox, send } = await mailer()

    await send({ user: user('es'), token: 't' })

    expect((await outbox.next(ADDRESS)).subject).toBe('Confirma tu correo para Perch')
  })

  it("writes in its settings' language once it has settings", async () => {
    const { local, outbox, send } = await mailer()
    const account = user('en')

    await local.db.query(settingsLocaleStatement, { identity: account.id, locale: 'es' })
    await send({ user: account, token: 't' })

    expect((await outbox.next(ADDRESS)).subject).toBe('Confirma tu correo para Perch')
  })

  it('sends nothing when the settings cannot be read, and reports it by its code', async () => {
    const { outbox, codes, lines, send } = await mailer({ settingsFail: true })

    await send({ user: user('es'), token: TOKEN })
    await settled()

    expect(outbox.sent).toEqual([])
    expect(codes()).toEqual(['mail:LOCALE_UNREADABLE'])
    expect(JSON.stringify(lines)).not.toMatch(/MARKER|ann@example\.test/)
  })

  it('reports a mail that names no account by its code, and sends nothing', async () => {
    const { outbox, codes, send } = await mailer()

    await send({ user: { email: ADDRESS }, token: 't' })
    await settled()

    expect(outbox.sent).toEqual([])
    expect(codes()).toEqual(['mail:SEND_FAILED'])
  })

  it('reports a mail the server did not take by its code, nothing of its address or token', async () => {
    const refusing: MailPort = {
      send: () =>
        errAsync({ code: 'mail:SEND_FAILED', message: `the server refused ${ADDRESS} ${TOKEN}` }),
    }
    const { codes, lines, send } = await mailer({ mail: refusing })

    await send({ user: user('en'), token: TOKEN })
    await settled()

    expect(codes()).toEqual(['mail:SEND_FAILED'])
    expect(JSON.stringify(lines)).not.toMatch(/MARKER|ann@example\.test/)
  })

  it('reports a mail it cannot write by its code, and sends nothing', async () => {
    const { outbox, codes, lines, send } = await mailer({ publicUrl: 'ftp://localhost:5443' })

    await send({ user: user('en'), token: TOKEN })
    await settled()

    expect(outbox.sent).toEqual([])
    expect(codes()).toEqual(['mail:LINK_INVALID'])
    expect(JSON.stringify(lines)).not.toMatch(/MARKER|ann@example\.test/)
  })

  it('puts the token into the link as a search parameter', () => {
    expect(verificationLink('https://localhost:5443', 'a+b/c=')).toBe(
      'https://localhost:5443/verify-email?token=a%2Bb%2Fc%3D',
    )
  })
})
