import { createServer, type Socket } from 'node:net'

export interface SmtpSink {
  /** `smtp://127.0.0.1:<port>`. */
  readonly url: string
  /** Everything the clients sent so far, as text. */
  received(): string
  close(): Promise<void>
}

export interface SmtpSinkOptions {
  /** Refuses every recipient with a 550 whose text echoes the address, as real servers do. */
  readonly refuseRecipients?: boolean
}

/** Answers one SMTP exchange line by line: EHLO, MAIL FROM, RCPT TO, DATA up to its dot, QUIT. */
function converse(socket: Socket, received: string[], options: SmtpSinkOptions): void {
  let data = false

  socket.write('220 sink ESMTP\r\n')
  socket.on('data', (chunk: Buffer) => {
    const text = chunk.toString()

    received.push(text)

    if (data) {
      if (text.includes('\r\n.\r\n')) {
        data = false
        socket.write('250 queued\r\n')
      }

      return
    }

    for (const line of text.split('\r\n').filter((each) => each !== '')) {
      if (/^(EHLO|HELO)/i.test(line)) socket.write('250-sink\r\n250 SMTPUTF8\r\n')
      else if (/^RCPT TO/i.test(line) && options.refuseRecipients === true) {
        socket.write(`550 5.1.1 ${line.slice(line.indexOf(':') + 1)}: no such recipient here\r\n`)
      } else if (/^(MAIL FROM|RCPT TO|RSET|NOOP)/i.test(line)) socket.write('250 ok\r\n')
      else if (/^DATA/i.test(line)) {
        data = true
        socket.write('354 go on\r\n')
      } else if (/^QUIT/i.test(line)) {
        socket.write('221 bye\r\n')
        socket.end()
      }
    }
  })
}

/** An SMTP server that takes every mail (or refuses every recipient) and keeps what it was sent. */
export async function smtpSink(options: SmtpSinkOptions = {}): Promise<SmtpSink> {
  const received: string[] = []
  const server = createServer((socket) => converse(socket, received, options))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `smtp://127.0.0.1:${port}`,
    received: () => received.join(''),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
