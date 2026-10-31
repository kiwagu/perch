import { okAsync, type ResultAsync } from 'neverthrow'

import type { MailError, MailMessage, MailPort } from '../mail.port'

/** How long a spec waits for a mail its sign-up or resend started, which nobody awaits. */
const WAIT_MS = 5_000

/** A mail port that keeps every mail in memory, oldest first: nothing is sent anywhere. */
export class Outbox implements MailPort {
  readonly sent: MailMessage[] = []
  readonly #waiting = new Set<() => void>()

  send(message: MailMessage): ResultAsync<void, MailError> {
    this.sent.push(message)

    for (const wake of this.#waiting) {
      wake()
    }

    return okAsync(undefined)
  }

  /** The mails to `address` (as the gateway keeps it, in lower case), oldest first. */
  to(address: string): MailMessage[] {
    return this.sent.filter((mail) => mail.to === address.toLowerCase())
  }

  /** The mail to `address` after its first `seen`, once it was sent; fails after `timeoutMs`. */
  next(address: string, seen = 0, timeoutMs = WAIT_MS): Promise<MailMessage> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#waiting.delete(check)
        reject(new Error(`no mail ${seen + 1} reached ${address} within ${timeoutMs} ms`))
      }, timeoutMs)
      const check = (): void => {
        const mail = this.to(address)[seen]

        if (mail !== undefined) {
          clearTimeout(timer)
          this.#waiting.delete(check)
          resolve(mail)
        }
      }

      this.#waiting.add(check)
      check()
    })
  }
}

/** The token of the verification link a mail's text carries. */
export function linkToken(mail: MailMessage): string {
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0]
  const token = link === undefined ? null : new URL(link).searchParams.get('token')

  if (token === null) {
    throw new Error(`the mail "${mail.subject}" carries no link with a token`)
  }

  return token
}
