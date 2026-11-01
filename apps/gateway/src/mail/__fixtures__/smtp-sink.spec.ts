import { connect } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { type SmtpSink, smtpSink } from './smtp-sink'

const sinks: SmtpSink[] = []

afterEach(async () => {
  for (const sink of sinks.splice(0)) {
    await sink.close()
  }
})

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Speaks to a new sink in `pieces`, each its own write after a pause so each reaches the sink as
 * a chunk of its own, and answers everything the sink replied once it closed (or after a second).
 */
async function exchange(pieces: readonly string[]): Promise<{ replies: string; sink: SmtpSink }> {
  const sink = await smtpSink()

  sinks.push(sink)

  const socket = connect(Number(new URL(sink.url).port), '127.0.0.1')
  const replies: string[] = []
  const closed = new Promise<void>((resolve) => socket.on('close', () => resolve()))

  socket.setNoDelay(true)
  socket.on('data', (chunk: Buffer) => replies.push(chunk.toString()))
  await new Promise<void>((resolve) => socket.once('connect', () => resolve()))

  for (const piece of pieces) {
    await pause(20)
    socket.write(piece)
  }

  await Promise.race([closed, pause(1_000)])
  socket.destroy()

  return { replies: replies.join(''), sink }
}

const SESSION = [
  '220 sink ESMTP\r\n',
  '250-sink\r\n250 SMTPUTF8\r\n',
  '250 ok\r\n',
  '250 ok\r\n',
  '354 go on\r\n',
  '250 queued\r\n',
  '221 bye\r\n',
].join('')

describe('smtpSink', () => {
  it('answers commands and a mail split across chunks anywhere, the dot that ends the mail included', async () => {
    const { replies, sink } = await exchange([
      'EH',
      'LO client\r\nMAIL FROM:<a@example.test>\r\nRC',
      'PT TO:<b@example.test>\r\nDATA\r\n',
      'Subject: x\r\n\r\nbody\r\n.',
      '\r\nQU',
      'IT\r\n',
    ])

    expect(replies).toBe(SESSION)
    expect(sink.received()).toContain('Subject: x\r\n\r\nbody\r\n.\r\n')
  })
  it('answers the commands that share a chunk with the start or the end of a mail', async () => {
    const { replies } = await exchange([
      'EHLO client\r\nMAIL FROM:<a@example.test>\r\nRCPT TO:<b@example.test>\r\nDATA\r\nSubject: y\r\n',
      '\r\nbody\r\n.\r\nQUIT\r\n',
    ])

    expect(replies).toBe(SESSION)
  })
})
