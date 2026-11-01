import type { Fetcher } from '../gateway-auth'

/** A request the fake `fetch` took: where, how, with which token and device, and its body. */
export interface SentRequest {
  readonly url: string
  readonly method: string | undefined
  readonly authorization: string | null
  readonly device: string | null
  /** The device's label, named only by a sign-up or sign-in. */
  readonly label?: string
  readonly body: unknown
}

/**
 * A `fetch` that answers each request in turn with the next answer (the last one again once
 * they run out) and records what was sent.
 */
export function fakeFetch(...answers: Array<() => Promise<Response>>) {
  const sent: SentRequest[] = []
  const fetcher: Fetcher = async (url, init) => {
    const headers = new Headers(init.headers)
    const label = headers.get('X-Perch-Device-Label')

    sent.push({
      url,
      method: init.method,
      authorization: headers.get('Authorization'),
      device: headers.get('X-Perch-Device'),
      ...(label === null ? {} : { label }),
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
    })

    const answer = answers[Math.min(sent.length, answers.length) - 1]

    if (!answer) throw new Error('no answer prepared')

    return answer()
  }

  return { fetcher, sent }
}

/** An answer with a JSON body. */
export const respond = (status: number, body: unknown) => () =>
  Promise.resolve(Response.json(body, { status }))

/** An answer whose body is `text`, not JSON. */
export const respondText = (status: number, text: string) => () =>
  Promise.resolve(new Response(text, { status, headers: { 'Content-Type': 'text/html' } }))

/** An answer without a body (204). */
export const noContent = () => () => Promise.resolve(new Response(null, { status: 204 }))
