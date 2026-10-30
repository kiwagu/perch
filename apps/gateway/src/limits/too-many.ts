const msPerSecond = 1000

/** 429 { code: 'rate-limited' } with Retry-After in whole seconds, at least 1. */
export function tooMany(refused: { readonly retryAfterMs: number }): Response {
  const seconds = Math.max(1, Math.ceil(refused.retryAfterMs / msPerSecond))

  return Response.json(
    { code: 'rate-limited' },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  )
}
