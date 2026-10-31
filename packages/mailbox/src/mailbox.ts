import { z } from '@workspace/zod'

import { type Mail, mailSchema } from './mail.schema'
import { firstLink, linkToken } from './mail-link'

/** The part of `fetch` the mailbox uses. */
export type MailboxFetcher = (url: string) => Promise<Response>

/** How long `next` waits for a mail, and how often it asks. */
const WAIT_MS = 10_000
const POLL_MS = 100

const mailsSchema = z.array(mailSchema)

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * A stand's MailDev, read through its REST API: the mails to an address, oldest first, and the
 * one after those a caller has seen, waited for (the gateway does not await its sends).
 */
export class Mailbox {
  readonly #baseUrl: string
  readonly #fetcher: MailboxFetcher

  constructor(baseUrl: string, fetcher: MailboxFetcher = (url) => fetch(url)) {
    this.#baseUrl = baseUrl
    this.#fetcher = fetcher
  }

  /**
   * The mails to `address`, in lower case as the gateway sends to it, oldest first. A failure
   * says what went wrong in fixed words: nothing of the address, and no cause that could hold it.
   */
  async mails(address: string): Promise<readonly Mail[]> {
    const url = new URL('/email', this.#baseUrl)

    url.searchParams.set('to.address', address.toLowerCase())

    const answer = await this.#fetcher(url.href).catch(() => {
      throw new Error('the mailbox did not answer')
    })

    if (!answer.ok) {
      throw new Error(`the mailbox answered ${answer.status}`)
    }

    const mails = mailsSchema.safeParse(await answer.json().catch(() => undefined))

    if (!mails.success) {
      throw new Error('the mailbox answered something other than a list of mails')
    }

    return mails.data
  }

  async count(address: string): Promise<number> {
    return (await this.mails(address)).length
  }

  /** The mail to `address` after its first `seen`, once it arrived; fails after `timeoutMs`. */
  async next(address: string, seen: number, timeoutMs = WAIT_MS): Promise<Mail> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const mail = (await this.mails(address))[seen]

      if (mail !== undefined) {
        return mail
      }

      if (Date.now() >= deadline) {
        throw new Error(`no mail ${seen + 1} came within ${timeoutMs} ms`)
      }

      await pause(POLL_MS)
    }
  }

  /** The token of the verification link in the mail to `address` after its first `seen`. */
  async verificationToken(address: string, seen: number): Promise<string> {
    return linkToken(firstLink(await this.next(address, seen)))
  }
}
