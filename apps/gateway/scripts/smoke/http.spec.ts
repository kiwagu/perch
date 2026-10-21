import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { call } from './http'

// A front that answers as a proxy may: plain text when the gateway behind it is down.
let server: Server
let base: string

beforeAll(async () => {
  server = createServer((request, response) => {
    if (request.url === '/json') {
      response.writeHead(400, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify({ code: 'invalid-body' }))

      return
    }

    response.writeHead(502, { 'Content-Type': 'text/plain' })
    response.end('Bad Gateway')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
})

describe('call', () => {
  it('answers a body that is not JSON as its text, so the step names the status', async () => {
    const answer = await call(base, 'GET', '/down', undefined)

    expect(answer).toMatchObject({ status: 502, body: 'Bad Gateway' })
  })

  it('answers a JSON body parsed', async () => {
    const answer = await call(base, 'GET', '/json', undefined)

    expect(answer).toMatchObject({ status: 400, body: { code: 'invalid-body' } })
  })
})
