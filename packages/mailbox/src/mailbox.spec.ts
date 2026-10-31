import { describe, expect, it, vi } from 'vitest'

import { expectNoLeak, LEAK, rejection } from './__fixtures__/leak'
import { Mailbox } from './mailbox'

const mail = (id: string, to: string) => ({
  id,
  subject: `Mail ${id}`,
  text: `Open https://localhost:5493/verify-email?token=tok-${id} now`,
  html: '<p>x</p>',
  to: [{ address: to, name: '' }],
  time: '2026-10-31T10:00:00.000Z',
})

/** A MailDev that holds `held()` and records each URL it was asked. */
function maildev(held: () => unknown[]) {
  const asked: string[] = []

  return {
    asked,
    fetcher: async (url: string) => {
      asked.push(url)

      return Response.json(held())
    },
  }
}

describe('Mailbox', () => {
  it("asks MailDev for one address's mails, in lower case", async () => {
    const fake = maildev(() => [mail('a', 'ann@example.test')])
    const box = new Mailbox('http://127.0.0.1:1090', fake.fetcher)

    expect((await box.mails('Ann@Example.test')).map(({ id }) => id)).toEqual(['a'])
    expect(fake.asked).toEqual(['http://127.0.0.1:1090/email?to.address=ann%40example.test'])
  })
  it('waits for the mail after the ones seen, and reads its verification token', async () => {
    let held = [mail('a', 'ann@example.test')]
    const box = new Mailbox('http://127.0.0.1:1090', maildev(() => held).fetcher)

    setTimeout(() => {
      held = [...held, mail('b', 'ann@example.test')]
    }, 150)

    expect(await box.verificationToken('ann@example.test', 1)).toBe('tok-b')
    expect(await box.count('ann@example.test')).toBe(2)
  })
  it('fails, naming no address, when no further mail comes in time', async () => {
    const box = new Mailbox('http://127.0.0.1:1090', maildev(() => []).fetcher)
    const error = await rejection(box.next(`${LEAK}@example.test`, 0, 300))

    expect(error).toHaveProperty('message', 'no mail 1 came within 300 ms')
    expectNoLeak(error)
  })
  it('fails when MailDev answers something that is not a list of mails', async () => {
    const box = new Mailbox('http://127.0.0.1:1090', async () => Response.json({ error: 'x' }))

    await expect(box.mails('ann@example.test')).rejects.toThrow()
  })
})

describe("Mailbox's failures carry nothing of the mailbox", () => {
  const address = `${LEAK}@example.test`
  const failing = (fetcher: (url: string) => Promise<Response>) =>
    rejection(new Mailbox('http://127.0.0.1:1090', fetcher).mails(address))

  it('when MailDev refuses, by its status alone', async () => {
    const error = await failing(
      async () => new Response(`no mails for ${address}`, { status: 500 }),
    )

    expect(error).toHaveProperty('message', 'the mailbox answered 500')
    expectNoLeak(error)
  })
  it('when the request fails with an error that names its URL', async () => {
    expectNoLeak(
      await failing(async (url) => {
        throw new TypeError(`fetch failed: ${url}`)
      }),
    )
  })
  it('when the answer is not JSON', async () => {
    expectNoLeak(await failing(async () => new Response(`"${address}`)))
  })
  it('when the answer is not a list of mails', async () => {
    expectNoLeak(await failing(async () => Response.json([{ id: address, subject: address }])))
  })
})

describe("Mailbox's waits hold their time whatever MailDev does", () => {
  /** A MailDev that takes each request and never answers it, keeping each request's signal. */
  function silent() {
    const signals: AbortSignal[] = []

    return {
      signals,
      fetcher: (_url: string, init?: { readonly signal: AbortSignal }) => {
        if (init !== undefined) {
          signals.push(init.signal)
        }

        return new Promise<Response>(() => {})
      },
    }
  }

  it('when MailDev never answers, and cancels the request', async () => {
    const fake = silent()
    const box = new Mailbox('http://127.0.0.1:1090', fake.fetcher)
    const started = Date.now()
    const error = await rejection(box.next('ann@example.test', 0, 300))

    expect(error).toHaveProperty('message', 'no mail 1 came within 300 ms')
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(fake.signals).not.toHaveLength(0)
    expect(fake.signals.every((signal) => signal.aborted)).toBe(true)
  })
  it("when MailDev's answer stalls in its body", async () => {
    const stalled = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start: (controller) => controller.enqueue(new TextEncoder().encode('[')),
        }),
      )
    const box = new Mailbox('http://127.0.0.1:1090', async () => stalled())
    const started = Date.now()
    const error = await rejection(box.next('ann@example.test', 0, 300))

    expect(error).toHaveProperty('message', 'no mail 1 came within 300 ms')
    expect(Date.now() - started).toBeLessThan(1_000)
  })
  it('when a look of its own never ends, after the default wait', async () => {
    vi.useFakeTimers()

    try {
      const box = new Mailbox('http://127.0.0.1:1090', silent().fetcher)
      const failure = rejection(box.mails('ann@example.test'))

      await vi.advanceTimersByTimeAsync(10_000)

      expect(await failure).toHaveProperty('message', 'the mailbox did not answer within 10000 ms')
    } finally {
      vi.useRealTimers()
    }
  })
})
