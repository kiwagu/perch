import { afterEach, describe, expect, it, vi } from 'vitest'

import { type SmtpSink, type SmtpSinkOptions, smtpSink } from './__fixtures__/smtp-sink'
import { SmtpMailer } from './smtp-mailer'

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

const MAIL = { to: 'ann@example.test', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' }

describe('SmtpMailer', () => {
  it('hands a mail to the SMTP server, from the configured address', async () => {
    const sink = await opened()
    const mailer = new SmtpMailer({ url: sink.url, from: 'Perch <no-reply@example.test>' })

    expect((await mailer.send(MAIL)).isOk()).toBe(true)
    expect(sink.received()).toContain('Subject: Hello')
    expect(sink.received()).toContain('From: Perch <no-reply@example.test>')
    expect(sink.received()).toContain('To: ann@example.test')
  })
  it('answers mail:SEND_FAILED when no server takes the mail', async () => {
    const mailer = new SmtpMailer({ url: 'smtp://127.0.0.1:1', from: 'no-reply@example.test' })
    const sent = await mailer.send(MAIL)

    expect(sent._unsafeUnwrapErr().code).toBe('mail:SEND_FAILED')
  })
  it('answers a refusal that echoes the address by its code and fixed text alone, and logs nothing', async () => {
    const sink = await opened({ refuseRecipients: true })
    const logged = (['debug', 'error', 'info', 'log', 'warn'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    )
    const sent = await new SmtpMailer({ url: sink.url, from: 'no-reply@example.test' }).send(MAIL)

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
  it('verifies a server that answers, and answers mail:UNREACHABLE for one that does not', async () => {
    const sink = await opened()

    expect((await new SmtpMailer({ url: sink.url, from: 'a@example.test' }).verify()).isOk()).toBe(
      true,
    )
    expect(
      (
        await new SmtpMailer({ url: 'smtp://127.0.0.1:1', from: 'a@example.test' }).verify()
      )._unsafeUnwrapErr().code,
    ).toBe('mail:UNREACHABLE')
  })
})
