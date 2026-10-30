import { createHash } from 'node:crypto'

import type { Fetcher } from '@workspace/web/seeding'

/**
 * The fetcher of a simulated client named `name`, playing the front. The spec talks to the
 * gateway directly, so, as the gateway's smoke and load test do, it names one client address per
 * simulated client in `X-Forwarded-For`, as Caddy names the address it saw: a stable
 * `198.18.<a>.<b>` (a range set aside for benchmarks) from a hash of the name, so the gateway's
 * limits per client address count each simulated client apart.
 */
export function simulatedFront(name: string): Fetcher {
  const [a = 0, b = 0] = createHash('sha256').update(name).digest()
  const address = `198.18.${a}.${b}`

  return (url, init) => {
    const headers = new Headers(init.headers)

    headers.set('X-Forwarded-For', address)

    return fetch(url, { ...init, headers })
  }
}
