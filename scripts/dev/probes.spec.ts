import { afterAll, describe, expect, it } from 'bun:test'

import { frontServes, healthy, portFree } from './probes.ts'

const portOf = (server: { readonly port: number | undefined }): number => {
  if (server.port === undefined) {
    throw new Error('the test server listens on no port')
  }

  return server.port
}

/** A local server that answers each path with the status it names. */
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (request) =>
    new Response(null, { status: Number(new URL(request.url).pathname.slice(1)) }),
})
const serverPort = portOf(server)
const at = (status: number): string => `http://127.0.0.1:${serverPort}/${status}`

/** A port nothing listens on: one a server held a moment ago. */
const closedPort = (() => {
  const held = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response() })
  const port = portOf(held)

  void held.stop(true)

  return port
})()

afterAll(() => server.stop(true))

describe("a service's health url", () => {
  it('is ready on a 2xx', async () => {
    expect(await healthy(at(200))).toBe(true)
    expect(await healthy(at(204))).toBe(true)
  })

  it('is not ready on a 404, a 401 or a server error, nor when nothing answers', async () => {
    expect(await healthy(at(404))).toBe(false)
    expect(await healthy(at(401))).toBe(false)
    expect(await healthy(at(503))).toBe(false)
    expect(await healthy(`http://127.0.0.1:${closedPort}/health`)).toBe(false)
  })
})

describe('the front', () => {
  it("serves on a 2xx, or the 404 it answers before the watcher's first build", async () => {
    expect(await frontServes(at(200))).toBe(true)
    expect(await frontServes(at(404))).toBe(true)
  })

  it('does not serve on another client error, a server error, or no answer', async () => {
    expect(await frontServes(at(401))).toBe(false)
    expect(await frontServes(at(502))).toBe(false)
    expect(await frontServes(`http://127.0.0.1:${closedPort}/`)).toBe(false)
  })
})

describe('a port', () => {
  it('is free when nothing listens on it, and held when something does', async () => {
    expect(await portFree(closedPort)).toBe(true)
    expect(await portFree(serverPort)).toBe(false)
  })
})
