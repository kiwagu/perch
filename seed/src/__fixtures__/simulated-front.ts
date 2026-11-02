import { createHash } from 'node:crypto'

import type { Fetcher } from '@workspace/web/seeding'

/**
 * The fetcher of a simulated client named `name`, playing the front at `origin`. The spec talks
 * to the gateway directly, so, as the gateway's smoke and load test do, it names one client
 * address per simulated client in `X-Forwarded-For`, as Caddy names the address it saw: a stable
 * `198.18.<a>.<b>` (a range set aside for benchmarks) from a hash of the name, so the gateway's
 * limits per client address count each simulated client apart. It also names the front's origin
 * in `Origin`, as a browser does: Node's fetch marks every request as a browser's
 * (`Sec-Fetch-Mode: cors`), and the gateway's sign-up and sign-in then refuse a request whose
 * origin is missing or is not the front's.
 */
export function simulatedFront(name: string, origin: string): Fetcher {
  const [a = 0, b = 0] = createHash('sha256').update(name).digest()
  const address = `198.18.${a}.${b}`

  return (url, init) => {
    const headers = new Headers(init.headers)

    headers.set('X-Forwarded-For', address)
    headers.set('Origin', origin)

    return fetch(url, { ...init, headers })
  }
}
