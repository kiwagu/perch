import { useRef, useState } from 'react'

/**
 * The exchange of a link's token, once per mounted page. React restarts a mounted screen's effects
 * once in development (StrictMode), which starts its machine's first invoke again, and the gateway
 * takes a link's token once: a second exchange would answer as for a link used before. The
 * exchange is kept by the mounted page and reused across that restart; a page mounted anew (a
 * later visit, another token in the address, which the page keys its machine by) asks afresh.
 * The function it returns stays the same for the page's life.
 */
export function useLinkExchange<T>(exchange: (token: string) => T): (token: string) => T {
  const latest = useRef(exchange)
  const [kept] = useState(() => new Map<string, T>())

  latest.current = exchange

  const [once] = useState(() => (token: string): T => {
    const known = kept.get(token)

    if (known !== undefined) {
      return known
    }

    const started = latest.current(token)

    kept.set(token, started)

    return started
  })

  return once
}
