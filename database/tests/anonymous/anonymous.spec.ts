import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// SurrealKit cannot act as an unauthenticated SQL client (its header-only actor runs
// with the runner's own credentials), so the guest stance is checked here with a raw
// HTTP request that carries no Authorization header at all.

const endpoint = process.env['SURREAL_URL'] ?? 'http://127.0.0.1:8010'
const query = readFileSync(new URL('./select-identities.surql', import.meta.url), 'utf8')

describe('an anonymous client', () => {
  it('cannot read identities', async () => {
    const response = await fetch(new URL('/sql', endpoint), {
      method: 'POST',
      headers: { Accept: 'application/json', 'surreal-ns': 'app', 'surreal-db': 'app' },
      body: query,
    })
    const body = (await response.json()) as { information?: string }

    expect(response.status).toBe(403)
    expect(body.information).toMatch(/Anonymous access not allowed/)
  })
})
