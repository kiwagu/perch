/**
 * The checks `bun run dev` makes on this host before it starts: whether a service's health url
 * answers it is ready, whether the front serves, and whether a port is free to listen on.
 */

import { createServer } from 'node:net'

/** How long a service has to answer its url. */
const ANSWER_TIMEOUT_MS = 2000

const isSuccess = (status: number): boolean => status >= 200 && status < 300

/**
 * The HTTP status `url` answers with, or none when nothing answers in time. The front's
 * certificate is the stands' own, so it is not verified.
 */
async function statusOf(url: string): Promise<number | undefined> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(ANSWER_TIMEOUT_MS),
      tls: { rejectUnauthorized: false },
    })

    return response.status
  } catch {
    return undefined
  }
}

/** Whether a service's health url answers that it is ready: a 2xx, nothing else. */
export async function healthy(url: string): Promise<boolean> {
  const status = await statusOf(url)

  return status !== undefined && isSuccess(status)
}

/**
 * Whether the front serves its page: a 2xx, or the 404 it answers until the watcher's first build
 * writes apps/web/dist-dev.
 */
export async function frontServes(url: string): Promise<boolean> {
  const status = await statusOf(url)

  return status !== undefined && (isSuccess(status) || status === 404)
}

/** Whether a server could listen on 127.0.0.1 at `port` now. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()

    server.once('error', () => resolve(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)))
  })
}
