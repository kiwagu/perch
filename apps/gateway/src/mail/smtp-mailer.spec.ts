import { afterEach, describe, expect, it, vi } from 'vitest'

import { type SmtpSink, type SmtpSinkOptions, smtpSink } from './__fixtures__/smtp-sink'
import { SmtpMailer, type SmtpMailerOptions } from './smtp-mailer'

const sinks: SmtpSink[] = []

afterEach(async () => {
  for (const sink of sinks.splice(0)) {
    await sink.close()
  }
})

const opened = async (options?: SmtpSinkOptions): Promise<SmtpSink> => {
  const sink = await smtpSink(options)

  sinks.push(sink)

  return sink
}

/** A mailer of an address the mail library takes. */
const mailerOf = (options: SmtpMailerOptions): SmtpMailer =>
  SmtpMailer.create(options)._unsafeUnwrap()

const MAIL = { to: 'ann@example.test', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' }

describe('SmtpMailer', () => {
  it('hands a mail to the SMTP server, from the configured address', async () => {
    const sink = await opened()
    const mailer = mailerOf({ url: sink.url, from: 'Perch <no-reply@example.test>' })

    expect((await mailer.send(MAIL)).isOk()).toBe(true)
    expect(sink.received()).toContain('Subject: Hello')
    expect(sink.received()).toContain('From: Perch <no-reply@example.test>')
    expect(sink.received()).toContain('To: ann@example.test')
  })
  it('answers mail:SEND_FAILED when no server takes the mail', async () => {
    const mailer = mailerOf({ url: 'smtp://127.0.0.1:1', from: 'no-reply@example.test' })
    const sent = await mailer.send(MAIL)

    expect(sent._unsafeUnwrapErr().code).toBe('mail:SEND_FAILED')
  })
  it('answers a refusal that echoes the address by its code and fixed text alone, and logs nothing', async () => {
    const sink = await opened({ refuseRecipients: true })
    const logged = (['debug', 'error', 'info', 'log', 'warn'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )
    const sent = await mailerOf({ url: sink.url, from: 'no-reply@example.test' }).send(MAIL)

    expect(sink.received()).toContain('RCPT TO:<ann@example.test>')
    expect(sent._unsafeUnwrapErr()).toStrictEqual({
      code: 'mail:SEND_FAILED',
      message: 'the mail server did not take a mail',
    })
    for (const spy of logged) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
  // The mail library refuses a host the URL standard takes for an opaque one (a NUL byte, written
  // %00), and its error carries the whole URL, the server's password with it.
  it('answers an address the mail library refuses by its code and fixed text alone, and logs nothing', () => {
    const marker = `marker-${crypto.randomUUID()}`
    const logged = (['debug', 'error', 'info', 'log', 'warn'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )
    const opened = SmtpMailer.create({
      url: `smtp://${marker}-user:${marker}-pass@bad%00.example.test:587`,
      from: 'no-reply@example.test',
    })

    expect(opened._unsafeUnwrapErr()).toStrictEqual({
      code: 'mail:URL_INVALID',
      message: 'the mail server address could not be used',
    })
    expect(JSON.stringify(opened)).not.toContain(marker)
    for (const spy of logged) {
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    }
  })
  it('gives up on a server that never greets once its wait is over, as unreachable', async () => {
    const sink = await opened({ silent: true })
    const mailer = mailerOf({
      url: sink.url,
      from: 'a@example.test',
      timeouts: { connectionMs: 200, greetingMs: 200, socketMs: 200 },
    })
    const started = performance.now()
    const verified = await mailer.verify()

    expect(verified._unsafeUnwrapErr().code).toBe('mail:UNREACHABLE')
    expect(performance.now() - started).toBeLessThan(2_000)
  })
  it('verifies a server that answers, and answers mail:UNREACHABLE for one that does not', async () => {
    const sink = await opened()

    expect((await mailerOf({ url: sink.url, from: 'a@example.test' }).verify()).isOk()).toBe(true)
    expect(
      (
        await mailerOf({ url: 'smtp://127.0.0.1:1', from: 'a@example.test' }).verify()
      )._unsafeUnwrapErr().code,
    ).toBe('mail:UNREACHABLE')
  })
})
