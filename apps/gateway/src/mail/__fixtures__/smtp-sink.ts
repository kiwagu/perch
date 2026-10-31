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
  /** Accepts connections and never greets, as a server that hangs. */
  readonly silent?: boolean
}

/** The line that ends a mail's DATA: a dot alone on its line. */
const MAIL_END = '\r\n.\r\n'

/**
 * Answers one SMTP exchange: EHLO, MAIL FROM, RCPT TO, DATA up to its dot, QUIT. TCP may split a
 * command, or the dot that ends a mail, across chunks, and join several in one: the sink keeps
 * what it has not read yet and reads only whole lines and whole mails.
 */
function converse(socket: Socket, received: string[], options: SmtpSinkOptions): void {
  let pending = ''
  let data = false
  let quit = false

  const answer = (line: string): void => {
    if (/^(EHLO|HELO)/i.test(line)) socket.write('250-sink\r\n250 SMTPUTF8\r\n')
    else if (/^RCPT TO/i.test(line) && options.refuseRecipients === true) {
      socket.write(`550 5.1.1 ${line.slice(line.indexOf(':') + 1)}: no such recipient here\r\n`)
    } else if (/^(MAIL FROM|RCPT TO|RSET|NOOP)/i.test(line)) socket.write('250 ok\r\n')
    else if (/^DATA/i.test(line)) {
      data = true
      socket.write('354 go on\r\n')
    } else if (/^QUIT/i.test(line)) {
      quit = true
      socket.write('221 bye\r\n')
      socket.end()
    }
  }

  /** Reads one whole command line, or the rest of a mail up to its end; false when it has neither yet, or after QUIT. */
  const readOne = (): boolean => {
    if (quit) return false

    if (data) {
      // The line break before the dot may be the DATA command's own, for a mail with no body.
      const end = `\r\n${pending}`.indexOf(MAIL_END)

      if (end === -1) return false

      pending = pending.slice(end + MAIL_END.length - 2)
      data = false
      socket.write('250 queued\r\n')

      return true
    }

    const lineEnd = pending.indexOf('\r\n')

    if (lineEnd === -1) return false

    const line = pending.slice(0, lineEnd)

    pending = pending.slice(lineEnd + 2)
    answer(line)

    return true
  }

  socket.write('220 sink ESMTP\r\n')
  socket.on('data', (chunk: Buffer) => {
    const text = chunk.toString()

    received.push(text)
    pending += text

    let read = true

    while (read) {
      read = readOne()
    }
  })
}

/** An SMTP server that takes every mail (or refuses every recipient, or never greets) and keeps what it was sent. */
export async function smtpSink(options: SmtpSinkOptions = {}): Promise<SmtpSink> {
  const received: string[] = []
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    // A client that gives up resets its connection: that ends its conversation, nothing more.
    socket.on('error', () => undefined)

    if (options.silent !== true) {
      converse(socket, received, options)
    }
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0

  return {
    url: `smtp://127.0.0.1:${port}`,
    received: () => received.join(''),
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }

        server.close(() => resolve())
      }),
  }
}
