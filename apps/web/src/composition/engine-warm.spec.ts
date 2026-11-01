import { describe, expect, it, vi } from 'vitest'

import { wasmEngineModule } from '@workspace/data/engines/wasm-module'

import { type WarmPage, warmEngines } from './engine-warm'

/** A page whose fetch answers `response`, on a connection that may ask to save data. */
function page(response: Promise<Response>, connection?: { saveData: boolean }) {
  const fetch = vi.fn((_url: RequestInfo | URL, _init?: RequestInit) => response)

  return { fetch, navigator: connection ? { connection } : {} } satisfies WarmPage
}

describe('warmEngines', () => {
  it("loads the space's code, and fetches the engine's module at low priority to the end", async () => {
    let read = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        read = true
        controller.enqueue(new Uint8Array([0, 97, 115, 109]))
        controller.close()
      },
    })
    const fake = page(Promise.resolve(new Response(body)))
    const load = vi.fn(() => Promise.resolve())

    warmEngines(fake, load)

    expect(load).toHaveBeenCalledOnce()
    expect(fake.fetch).toHaveBeenCalledWith(wasmEngineModule, { priority: 'low' })
    await vi.waitFor(() => expect(read).toBe(true))
  })

  it('loads nothing when the browser asks to save data', () => {
    const fake = page(Promise.resolve(new Response('')), { saveData: true })
    const load = vi.fn(() => Promise.resolve())

    warmEngines(fake, load)

    expect(load).not.toHaveBeenCalled()
    expect(fake.fetch).not.toHaveBeenCalled()
  })

  it('lets a failed load go: the space loads its engines itself when it opens', async () => {
    const failed = Promise.reject(new TypeError('Failed to fetch'))
    const fake = page(failed)
    const load = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch dynamically imported module')),
    )

    warmEngines(fake, load)

    await expect(failed).rejects.toThrow('Failed to fetch')
    expect(load).toHaveBeenCalledOnce()
    expect(fake.fetch).toHaveBeenCalledOnce()
  })
})
