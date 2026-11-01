import type { ResultAsync } from 'neverthrow'

/** One mail: its one recipient, its subject, and its body as plain text and as HTML. */
export interface MailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

/** Why a mail did not go out, by its code; never with the mail's address or content. */
export interface MailError {
  readonly code: 'mail:SEND_FAILED' | 'mail:UNREACHABLE'
  readonly message: string
}

/**
 * Why the mailer could not be built: the mail library refused the server's address. Never with
 * that address, which may carry the server's password.
 */
export interface MailSetupError {
  readonly code: 'mail:URL_INVALID'
  readonly message: string
}

/** Where the gateway's mails go out: `send` resolves once the mail server took the mail. */
export interface MailPort {
  send(message: MailMessage): ResultAsync<void, MailError>
}
