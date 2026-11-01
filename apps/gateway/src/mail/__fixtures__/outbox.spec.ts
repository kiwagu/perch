import { describe, expect, it } from 'vitest'

import { linkToken, Outbox } from './outbox'

const mail = (text: string) => ({ to: 'ann@example.test', subject: 'Confirm Ann', text, html: '' })

describe('Outbox', () => {
  it('hands over a mail sent after it was awaited, by the address in any case', async () => {
    const outbox = new Outbox()
    const awaited = outbox.next('Ann@Example.test')
    const sent = mail('Hi')

    outbox.send(sent)

    expect(await awaited).toBe(sent)
  })
  it('fails a wait with a fixed message that names no address', async () => {
    await expect(new Outbox().next('ann@example.test', 0, 10)).rejects.toThrow(
      /^no awaited mail was sent in time$/,
    )
  })
})

describe('linkToken', () => {
  it('reads the token of the link a mail carries', () => {
    expect(linkToken(mail('Hello\n\nhttps://localhost:5443/verify-email?token=a.b.c\n\nBye'))).toBe(
      'a.b.c',
    )
  })
  // Each case by a fixed label: a test report prints its title, and a mail's text may carry a link.
  it.each([
    ['no link', 'Hello, no link here'],
    ['a link without a token', 'Hello\n\nhttps://localhost:5443/verify-email?code=a.b.c'],
  ])(
    'fails with a fixed message that names nothing of the mail when it carries %s',
    (_label, text) => {
      expect(() => linkToken(mail(text))).toThrow(/^the mail carries no link with a token$/)
    },
  )
  it('fails with a fixed message that names nothing of a link it cannot read', () => {
    expect(() =>
      linkToken(mail('Hello\n\nhttps://localhost:99999/verify-email?token=a.b.c')),
    ).toThrow(/^the link of the mail cannot be read$/)
  })
})
