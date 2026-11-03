import { errAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { interceptQueries } from '@workspace/data/testing'
import { idSchemas } from '@workspace/ids'

import type { MailPort } from '../mail'

import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import settingsLocaleStatement from './__fixtures__/settings-locale.surql'
import { AccountMails } from './account-mails'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const NEW_EMAIL = 'n3w-mailbox@elsewhere-domain.test'
const TOKEN = 'tok_MARKER_0123'

interface HarnessOptions {
  /** The read of the account's settings fails. */
  readonly settingsFail?: boolean
  /** The mail port, the instance's outbox unless named. */
  readonly mail?: MailPort
}

/** Ann signed up in `locale` and verified, and the gateway's mails about her account. */
async function harness(locale: 'en' | 'es' = 'en', options: HarnessOptions = {}) {
  const opened = await openAuth()

  closers.push(opened.close)

  const { user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'), { locale })
  const directory = options.settingsFail
    ? interceptQueries(opened.local, (text) => {
        if (text.includes('FROM ONLY settings')) {
          throw new Error(`the directory is down for ${ANN}`)
        }
      })
    : opened.local
  const mails = new AccountMails({
    mail: options.mail ?? opened.outbox,
    directory,
    publicUrl: 'https://localhost:5443',
    log: opened.log,
  })

  return { ...opened, mails, identity: idSchemas.identity.schema.parse(user.id) }
}

/** Waits until `logs` holds a line, the mail having gone nowhere. */
async function loggedLine(logs: ReadonlyArray<{ code: string; message: string }>) {
  await expect.poll(() => logs.length).toBeGreaterThan(0)

  return logs
}

describe('AccountMails', () => {
  it('mails the reset link to the account, linking to the reset screen with the token', async () => {
    const { mails, outbox, identity } = await harness()

    mails.resetPassword(identity, TOKEN)

    const mail = await outbox.next(ANN, 1)

    expect(mail.subject).toBe('Set a new password for Perch')
    expect(mail.text).toContain(`https://localhost:5443/reset-password?token=${TOKEN}`)
  })

  it('mails the confirmation to the new email, linking to the confirmation screen', async () => {
    const { mails, outbox, identity } = await harness()

    mails.confirmEmail(identity, NEW_EMAIL, TOKEN)

    const mail = await outbox.next(NEW_EMAIL)

    expect(mail.to).toBe(NEW_EMAIL)
    expect(mail.text).toContain(`https://localhost:5443/confirm-email?token=${TOKEN}`)
  })

  it('tells the account of a changed password, linking to the request for a new one', async () => {
    const { mails, outbox, identity } = await harness()

    mails.passwordChanged(identity)

    const mail = await outbox.next(ANN, 1)

    expect(mail.subject).toBe('Your Perch password was changed')
    expect(mail.text).toContain('https://localhost:5443/forgot-password')
  })

  it('tells the old address of a changed email, once the account has its new one', async () => {
    const { mails, outbox, identity, emailChanges } = await harnessWithChanges()

    expect((await emailChanges.move(identity, ANN, NEW_EMAIL))._unsafeUnwrap()).toBe(true)
    mails.emailChanged(identity, ANN)

    const mail = await outbox.next(ANN, 1)

    expect(mail.to).toBe(ANN)
    expect(mail.subject).toBe('Your Perch account has a new email')
    expect(`${mail.text}${mail.html}`).not.toContain('elsewhere-domain')
    expect(`${mail.text}${mail.html}`).not.toContain('n3w-mailbox')
  })

  it('speaks the language the account signed up in until its settings name one', async () => {
    const { mails, outbox, identity, local } = await harness('es')

    mails.passwordChanged(identity)
    expect((await outbox.next(ANN, 1)).subject).toBe('Tu contraseña de Perch cambió')

    await local.db.query(settingsLocaleStatement, { identity, locale: 'en' })
    mails.passwordChanged(identity)
    expect((await outbox.next(ANN, 2)).subject).toBe('Your Perch password was changed')
  })

  it('sends nothing when the settings cannot be read, and logs the code alone', async () => {
    const { mails, outbox, identity, logs } = await harness('en', { settingsFail: true })

    mails.passwordChanged(identity)

    expect(await loggedLine(logs)).toEqual([
      {
        level: 'error',
        code: 'mail:LOCALE_UNREADABLE',
        message: 'a password-changed notice did not go out',
      },
    ])
    expect(outbox.to(ANN)).toHaveLength(1)
  })

  it('logs a mail the mail server did not take by its code, naming no address or token', async () => {
    const { mails, identity, logs } = await harness('en', {
      mail: {
        send: () => errAsync({ code: 'mail:UNREACHABLE', message: 'the mail server is down' }),
      },
    })

    mails.resetPassword(identity, TOKEN)

    const lines = await loggedLine(logs)

    expect(lines).toEqual([
      { level: 'error', code: 'mail:UNREACHABLE', message: 'a reset mail did not go out' },
    ])
    expect(JSON.stringify(lines)).not.toContain(TOKEN)
    expect(JSON.stringify(lines)).not.toContain(ANN)
  })

  it('sends nothing for an identity that is gone, and logs the code alone', async () => {
    const { mails, logs } = await harness()

    mails.passwordChanged(idSchemas.identity.schema.parse('idn_0000000000000000.0000000000'))

    expect(await loggedLine(logs)).toEqual([
      {
        level: 'error',
        code: 'mail:SEND_FAILED',
        message: 'a password-changed notice did not go out',
      },
    ])
  })
})

/** The harness with the gateway's email changes over the same directory. */
async function harnessWithChanges() {
  const opened = await harness()

  return { ...opened, emailChanges: accountServicesOf(opened).emailChanges }
}
