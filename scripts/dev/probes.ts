/**
 * The checks `bun run dev` makes on this host before it starts: whether a service answers at its
 * url, and whether a port is free to listen on.
 */

import { createServer } from 'node:net'

/** How long a service has to answer its url. */
const ANSWER_TIMEOUT_MS = 2000

/**
 * Whether something answers HTTP at `url` without a server error: the stands' front answers 404
 * until the watcher's first build, and its certificate is the stands' own, so it is not verified.
 */
export async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
      tls: { rejectUnauthorized: false },
    })

    return response.status < 500
  } catch {
    return false
  }
}

/** Whether a server could listen on 127.0.0.1 at `port` now. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
