import { Result, ResultAsync } from 'neverthrow'
import {
  createTransport,
  type Mail,
  type SMTPSentMessageInfo,
  type SMTPTransportOptions,
} from 'nodemailer'

import type { MailError, MailMessage, MailPort, MailSetupError } from './mail.port'

/** How long the server has to accept a connection; nodemailer's own 2 minutes would hold a start or a send. */
const CONNECTION_TIMEOUT_MS = 10_000

/** How long the server has to greet once connected; nodemailer's own 30 s would hold a start or a send. */
const GREETING_TIMEOUT_MS = 10_000

/** How long an exchange may stay silent; nodemailer's own 10 minutes would hold a send. */
const SOCKET_TIMEOUT_MS = 10_000

/** The waits of one exchange with the server, in milliseconds. */
export interface SmtpTimeouts {
  readonly connectionMs: number
  readonly greetingMs: number
  readonly socketMs: number
}

export interface SmtpMailerOptions {
  /** The SMTP server: `smtp://host:port`, or `smtps://user:password@host:port`. */
  readonly url: string
  /** The From of every mail, such as `Perch <no-reply@example.test>`. */
  readonly from: string
  /** The waits, 10 s each unless a spec shortens them. */
  readonly timeouts?: SmtpTimeouts
}

/** The transport nodemailer builds for one SMTP server. */
type SmtpTransport = Mail<SMTPSentMessageInfo, SMTPTransportOptions>

/**
 * The mail port over one SMTP server, through nodemailer. A failure answers by its code: the
 * server's text, which may echo the address, stays out of it.
 */
export class SmtpMailer implements MailPort {
  readonly #transport: SmtpTransport
  readonly #from: string

  private constructor(transport: SmtpTransport, from: string) {
    this.#transport = transport
    this.#from = from
  }

  /**
   * The mailer of the server at `options.url`; nothing connects yet. The mail library reads the
   * address at once and refuses a host it cannot use with an error that carries the whole
   * address, the server's password with it: that answers `mail:URL_INVALID` with fixed words, and
   * keeps nothing of the error.
   */
  static create(options: SmtpMailerOptions): Result<SmtpMailer, MailSetupError> {
    const timeouts = options.timeouts ?? {
      connectionMs: CONNECTION_TIMEOUT_MS,
      greetingMs: GREETING_TIMEOUT_MS,
      socketMs: SOCKET_TIMEOUT_MS,
    }
    const transport = Result.fromThrowable(
      () =>
        createTransport({
          url: options.url,
          connectionTimeout: timeouts.connectionMs,
          greetingTimeout: timeouts.greetingMs,
          socketTimeout: timeouts.socketMs,
        }),
      (): MailSetupError => ({
        code: 'mail:URL_INVALID',
        message: 'the mail server address could not be used',
      }),
    )

    return transport().map((built) => new SmtpMailer(built, options.from))
  }

  /** Connects and greets the server once, within the waits: a gateway whose mail server does not answer does not start. */
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
