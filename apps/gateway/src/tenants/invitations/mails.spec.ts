import { errAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import type { Locale } from '@workspace/i18n/translator'
import { type IdentityId, idSchemas } from '@workspace/ids'
import { createLogger } from '@workspace/logger'

import { deviceHeaders, openAuth, signUpOn } from '../../auth/__fixtures__/auth-instance'
import settingsLocaleStatement from '../../auth/__fixtures__/settings-locale.surql'
import type { MailError, MailMessage, MailPort } from '../../mail'

import { invitationLink } from './link'
import { InvitationMails } from './mails'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const BOB = 'bob@example.test'
const CAROL = 'carol@example.test'
const TOKEN = 'tok_MARKER_0123'
const PUBLIC_URL = 'https://localhost:5443'

interface HarnessOptions {
  /** The mail port, the instance's outbox unless named. */
  readonly mail?: MailPort
  /** Makes a query of the directory fail when its text says so. */
  readonly failing?: (text: string) => boolean
  /** What every read of the settings' language answers, as a directory whose settings hold it. */
  readonly settingsAnswer?: unknown
  /** Makes every query of the directory throw at once, not reject. */
  readonly throwingAtOnce?: boolean
}

/**
 * The directory with every read of the settings' language answering `answer`: the schema refuses a
 * language it does not speak, so only an answer made up here can name one.
 */
function answeringSettings(local: LocalDb, answer: unknown): LocalDb {
  const query = (text: string, bindings?: Record<string, unknown>) =>
    text.includes('FROM ONLY settings') ? Promise.resolve([answer]) : local.db.query(text, bindings)
  const db = new Proxy(local.db, {
    get(target, property) {
      if (property === 'query') {
        return query
      }

      const value: unknown = Reflect.get(target, property)

      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })

  return { ...local, db }
}

/**
 * The directory whose every query throws at once, before it hands anything back: `interceptQueries`
 * turns a throw into a rejection, so only a directory built by hand reaches the code that starts a
 * query.
 */
function throwingAtOnce(local: LocalDb): LocalDb {
  const db = new Proxy(local.db, {
    get(target, property) {
      if (property === 'query') {
        return () => {
          throw new Error(`the directory threw at once for ${BOB}`)
        }
      }

      const value: unknown = Reflect.get(target, property)

      return typeof value === 'function' ? (value as () => unknown).bind(target) : value
    },
  })

  return { ...local, db }
}

/** A mail port whose mails never settle: the server never answers. */
function silentPort(): { port: MailPort; reached: () => number } {
  const send = vi.fn(
    (): ResultAsync<void, MailError> => new ResultAsync(new Promise<never>(() => undefined)),
  )

  return { port: { send }, reached: () => send.mock.calls.length }
}

/**
 * Ann (the inviter, signed up in `inviterLocale`) and Bob (signed up in `bobLocale`) over one
 * directory, and the invitation mails as the gateway builds them: its log lines kept as parsed
 * JSON, as the gateway's own logger writes them.
 */
async function harness(
  inviterLocale: Locale = 'en',
  bobLocale: Locale = 'en',
  options: HarnessOptions = {},
) {
  const opened = await openAuth()

  closers.push(opened.close)

  const ann = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'), {
    locale: inviterLocale,
    name: 'Ann',
  })
  const bob = await signUpOn(opened.auth, BOB, deviceHeaders('phone'), {
    locale: bobLocale,
    name: 'Bob',
  })
  const lines: string[] = []
  const log = createLogger('organisations', {
    level: 'error',
    format: 'json',
    destination: { write: (line) => lines.push(line) },
  })
  const failing = options.failing
  const directory =
    failing === undefined
      ? opened.local
      : interceptQueries(opened.local, (text) => {
          if (failing(text)) {
            throw new Error(`the directory is down for ${BOB}`)
          }
        })
  const answering =
    options.settingsAnswer === undefined
      ? directory
      : answeringSettings(directory, options.settingsAnswer)
  const read = options.throwingAtOnce === true ? throwingAtOnce(answering) : answering
  const mails = new InvitationMails({
    mail: options.mail ?? opened.outbox,
    directory: read,
    link: (token) => invitationLink(PUBLIC_URL, token),
    log,
  })
  const identities = {
    ann: idSchemas.identity.schema.parse(ann.user.id),
    bob: idSchemas.identity.schema.parse(bob.user.id),
  }

  return {
    ...opened,
    mails,
    identities,
    lines,
    /** The log lines so far, each parsed. */
    logged: (): Array<Record<string, unknown>> =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

/** Invites `email` to Acme as `role` from `inviter`. */
const invite = (
  mails: InvitationMails,
  inviter: IdentityId,
  email: string,
  role: 'member' | 'admin' = 'member',
) => mails.invite({ email, organisation: 'Acme Robotics', role, token: TOKEN, inviter })

/** Waits until the log holds a line, the mail having gone nowhere. */
async function loggedLine(logged: () => Array<Record<string, unknown>>) {
  await expect.poll(() => logged().length).toBeGreaterThan(0)

  return logged()
}

describe('InvitationMails', () => {
  it('mails an email that has an account in the language its settings name', async () => {
    const { mails, outbox, identities, local } = await harness('en', 'en')

    await local.db.query(settingsLocaleStatement, { identity: identities.bob, locale: 'es' })
    invite(mails, identities.ann, BOB, 'admin')

    const mail = await outbox.next(BOB, 1)

    expect(mail.to).toBe(BOB)
    expect(mail.subject).toBe('Te invitaron a unirte a una organización en Perch')
    expect(mail.text).toContain('Acme Robotics')
    expect(mail.text).toContain('como administrador')
  })

  it("speaks the recipient's sign-up language until its settings name one, whatever the inviter reads", async () => {
    const { mails, outbox, identities } = await harness('en', 'es')

    invite(mails, identities.ann, BOB)

    expect((await outbox.next(BOB, 1)).subject).toBe(
      'Te invitaron a unirte a una organización en Perch',
    )
  })

  it("mails an email without an account in the inviter's settings language", async () => {
    const { mails, outbox, identities, local } = await harness('en', 'en')

    await local.db.query(settingsLocaleStatement, { identity: identities.ann, locale: 'es' })
    invite(mails, identities.ann, CAROL)

    const mail = await outbox.next(CAROL)

    expect(mail.subject).toBe('Te invitaron a unirte a una organización en Perch')
    expect(mail.text).toContain('Hola:')
  })

  it('mails an email without an account in the language the inviter signed up in, as the inviter has no settings yet', async () => {
    const { mails, outbox, identities } = await harness('es', 'en')

    invite(mails, identities.ann, CAROL)

    expect((await outbox.next(CAROL)).subject).toBe(
      'Te invitaron a unirte a una organización en Perch',
    )
  })

  it('greets no one by name and names no inviter, whether or not the recipient has an account', async () => {
    const { mails, outbox, identities } = await harness('en', 'en')

    invite(mails, identities.ann, BOB)
    invite(mails, identities.ann, CAROL)

    for (const mail of [await outbox.next(BOB, 1), await outbox.next(CAROL)]) {
      expect(mail.text).toContain('Hello,')
      expect(mail.text).not.toContain('Ann')
      expect(mail.text).not.toContain('Bob')
    }
  })

  it('links to the invitation screen with the token', async () => {
    const { mails, outbox, identities } = await harness()

    invite(mails, identities.ann, CAROL)

    const mail = await outbox.next(CAROL)

    expect(mail.text).toContain(`${PUBLIC_URL}/invitation?token=${TOKEN}`)
    expect(mail.html).toContain(`${PUBLIC_URL}/invitation?token=${TOKEN}`)
  })

  it('sends nothing when the recipient settings name a language the mails are not written in, and logs the code alone', async () => {
    const { mails, outbox, identities, logged } = await harness('en', 'en', {
      settingsAnswer: 'fr',
    })

    invite(mails, identities.ann, BOB)

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:LOCALE_UNREADABLE' })
    expect(JSON.stringify(lines)).not.toContain(BOB)
    expect(JSON.stringify(lines)).not.toContain(TOKEN)
    expect(outbox.to(BOB)).toHaveLength(1)
  })

  it('sends nothing when the recipient settings cannot be read, and logs the code alone', async () => {
    const { mails, outbox, identities, logged } = await harness('en', 'en', {
      failing: (text) => text.includes('FROM ONLY settings'),
    })

    invite(mails, identities.ann, BOB)

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:LOCALE_UNREADABLE' })
    expect(JSON.stringify(lines)).not.toContain(BOB)
    expect(outbox.to(BOB)).toHaveLength(1)
  })

  it('sends no mail in a guessed language when the account its email found cannot be read', async () => {
    const { mails, outbox, identities, logged } = await harness('en', 'es', {
      failing: (text) => text.includes("FROM ONLY type::record('identity'"),
    })

    invite(mails, identities.ann, BOB)

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:SEND_FAILED' })
    expect(JSON.stringify(lines)).not.toContain(BOB)
    expect(outbox.to(BOB)).toHaveLength(1)
  })

  it('sends nothing to an email without an account when the inviter is gone, and logs the code alone', async () => {
    const { mails, outbox, logged } = await harness()

    invite(mails, idSchemas.identity.schema.parse('idn_0000000000000000.0000000000'), CAROL)

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:SEND_FAILED' })
    expect(JSON.stringify(lines)).not.toContain(CAROL)
    expect(outbox.to(CAROL)).toHaveLength(0)
  })

  it('sends nothing when the directory cannot say whose the email is, and logs the code alone', async () => {
    const { mails, outbox, identities, logged } = await harness('en', 'en', {
      failing: (text) => text.includes('FROM ONLY identity'),
    })

    invite(mails, identities.ann, CAROL)

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:SEND_FAILED' })
    expect(JSON.stringify(lines)).not.toContain(CAROL)
    expect(outbox.to(CAROL)).toHaveLength(0)
  })

  it('keeps a directory that throws at once from its caller, sends nothing and logs the code alone', async () => {
    const { mails, outbox, identities, logged } = await harness('en', 'en', {
      throwingAtOnce: true,
    })

    expect(invite(mails, identities.ann, BOB)).toBeUndefined()

    const lines = await loggedLine(logged)

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:SEND_FAILED' })
    expect(JSON.stringify(lines)).not.toContain(BOB)
    expect(JSON.stringify(lines)).not.toContain(TOKEN)
    expect(outbox.to(BOB)).toHaveLength(1)
  })

  it('logs a mail the mail server did not take by its code, naming no address or token', async () => {
    const failed: MailMessage[] = []
    const { mails, identities, logged } = await harness('en', 'en', {
      mail: {
        send: (message) => {
          failed.push(message)

          return errAsync({ code: 'mail:UNREACHABLE', message: 'the mail server is down' })
        },
      },
    })

    invite(mails, identities.ann, CAROL)

    const lines = await loggedLine(logged)

    expect(failed).toHaveLength(1)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ code: 'mail:UNREACHABLE' })
    expect(JSON.stringify(lines)).not.toContain(CAROL)
    expect(JSON.stringify(lines)).not.toContain(TOKEN)
  })

  it('returns before the mail port answers, which here never does', async () => {
    const { port, reached } = silentPort()
    const { mails, identities } = await harness('en', 'en', { mail: port })

    expect(invite(mails, identities.ann, CAROL)).toBeUndefined()

    await expect.poll(reached).toBe(1)
  })
})
