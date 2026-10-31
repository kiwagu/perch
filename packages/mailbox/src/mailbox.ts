import { z } from '@workspace/zod'

import { type Mail, mailSchema } from './mail.schema'
import { firstLink, linkToken } from './mail-link'

/** The part of `fetch` the mailbox uses: a request, and the signal that cancels it and its body. */
export type MailboxFetcher = (
  url: string,
  init: { readonly signal: AbortSignal },
) => Promise<Response>

/** How long `next` waits for a mail (and a look of `mails` may take), and how often it asks. */
const WAIT_MS = 10_000
const POLL_MS = 100

const mailsSchema = z.array(mailSchema)

/** What a look gives when its time ran out before MailDev answered in full. */
const TIMED_OUT = Symbol('timed out')

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * What `work` gives, or `TIMED_OUT` as soon as `signal` aborts, whether or not `work` heeds the
 * signal; what `work` does afterwards is dropped.
 */
function within<T>(work: Promise<T>, signal: AbortSignal): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const stop = () => resolve(TIMED_OUT)

    signal.addEventListener('abort', stop, { once: true })
    void work.then(resolve, reject).finally(() => signal.removeEventListener('abort', stop))
  })
}

/**
 * A stand's MailDev, read through its REST API: the mails to an address, oldest first, and the
 * one after those a caller has seen, waited for (the gateway does not await its sends). Every
 * look, its request and the reading of the answer, ends within the time it was given, and its
 * request is cancelled when it runs out. A failure says what went wrong in fixed words: nothing
 * of the address, and no cause that could hold it.
 */
export class Mailbox {
  readonly #baseUrl: string
  readonly #fetcher: MailboxFetcher

  constructor(baseUrl: string, fetcher: MailboxFetcher = (url, init) => fetch(url, init)) {
    this.#baseUrl = baseUrl
    this.#fetcher = fetcher
  }

  /** The mails to `address`, in lower case as the gateway sends to it, oldest first. */
  async mails(address: string): Promise<readonly Mail[]> {
    const mails = await this.#look(address, WAIT_MS)

    if (mails === TIMED_OUT) {
      throw new Error(`the mailbox did not answer within ${WAIT_MS} ms`)
    }

    return mails
  }

  async count(address: string): Promise<number> {
    return (await this.mails(address)).length
  }

  /** The mail to `address` after its first `seen`, once it arrived; fails after `timeoutMs`. */
  async next(address: string, seen: number, timeoutMs = WAIT_MS): Promise<Mail> {
    const deadline = Date.now() + timeoutMs

    for (;;) {
      const mails = await this.#look(address, deadline - Date.now())
      const mail = mails === TIMED_OUT ? undefined : mails[seen]

      if (mail !== undefined) {
        return mail
      }

      const left = deadline - Date.now()

      if (mails === TIMED_OUT || left <= 0) {
        throw new Error(`no mail ${seen + 1} came within ${timeoutMs} ms`)
      }

      await pause(Math.min(POLL_MS, left))
    }
  }

  /** The token of the verification link in the mail to `address` after its first `seen`. */
  async verificationToken(address: string, seen: number): Promise<string> {
    return linkToken(firstLink(await this.next(address, seen)))
  }

  /** The mails to `address`, or `TIMED_OUT` when MailDev did not answer in full within `budgetMs`. */
  async #look(address: string, budgetMs: number): Promise<readonly Mail[] | typeof TIMED_OUT> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(budgetMs, 0))

    try {
      return await within(this.#read(address, controller.signal), controller.signal)
    } finally {
      clearTimeout(timer)
    }
  }

  async #read(address: string, signal: AbortSignal): Promise<readonly Mail[]> {
    const url = new URL('/email', this.#baseUrl)

    url.searchParams.set('to.address', address.toLowerCase())

    const answer = await this.#fetcher(url.href, { signal }).catch(() => {
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
}
