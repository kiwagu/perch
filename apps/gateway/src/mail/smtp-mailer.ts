import { ResultAsync } from 'neverthrow'
import {
  createTransport,
  type Mail,
  type SMTPSentMessageInfo,
  type SMTPTransportOptions,
} from 'nodemailer'

import type { MailError, MailMessage, MailPort } from './mail.port'

export interface SmtpMailerOptions {
  /** The SMTP server: `smtp://host:port`, or `smtps://user:password@host:port`. */
  readonly url: string
  /** The From of every mail, such as `Perch <no-reply@example.test>`. */
  readonly from: string
}

/**
 * The mail port over one SMTP server, through nodemailer. A failure answers by its code: the
 * server's text, which may echo the address, stays out of it.
 */
export class SmtpMailer implements MailPort {
  readonly #transport: Mail<SMTPSentMessageInfo, SMTPTransportOptions>
  readonly #from: string

  constructor(options: SmtpMailerOptions) {
    this.#transport = createTransport(options.url)
    this.#from = options.from
  }

  /** Connects and greets the server once: a gateway whose mail server does not answer does not start. */
  verify(): ResultAsync<void, MailError> {
    return ResultAsync.fromPromise(
      this.#transport.verify(),
      (): MailError => ({ code: 'mail:UNREACHABLE', message: 'the mail server did not answer' }),
    ).map(() => undefined)
  }

  send(message: MailMessage): ResultAsync<void, MailError> {
    return ResultAsync.fromPromise(
      this.#transport.sendMail({ from: this.#from, ...message }),
      (): MailError => ({
        code: 'mail:SEND_FAILED',
        message: 'the mail server did not take a mail',
      }),
    ).map(() => undefined)
  }
}
