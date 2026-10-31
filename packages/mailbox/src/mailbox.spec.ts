import { describe, expect, it } from 'vitest'

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
  it('fails, naming the address, when no further mail comes in time', async () => {
    const box = new Mailbox('http://127.0.0.1:1090', maildev(() => []).fetcher)

    await expect(box.next('ann@example.test', 0, 300)).rejects.toThrow(
      'no mail 1 reached ann@example.test',
    )
  })
  it('fails when MailDev answers something that is not a list of mails', async () => {
    const box = new Mailbox('http://127.0.0.1:1090', async () => Response.json({ error: 'x' }))

    await expect(box.mails('ann@example.test')).rejects.toThrow()
  })
})
