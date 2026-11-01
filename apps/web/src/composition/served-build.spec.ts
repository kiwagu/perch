import { describe, expect, it, vi } from 'vitest'

import { manualClock } from '@workspace/replica/testing'

import type { Visibility } from './identity-space'
import { type Build, servedBuild } from './served-build'

const RUNNING: Build = { version: '0.1.0', commit: 'a'.repeat(40) }
const NEWER: Build = { version: '0.1.0', commit: 'b'.repeat(40) }
const TEN_MINUTES = 10 * 60 * 1000

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A server whose manifest names `served`, or answers `answer` instead; and a tab over it. */
function tab() {
  let answer: () => Promise<Response> = () => manifest(RUNNING)
  let state: Visibility = 'visible'
  const listeners = new Set<(state: Visibility) => void>()
  const fetcher = vi.fn((_url: string, _init: RequestInit) => answer())
  const clock = manualClock()
  const heard: string[] = []
  const watch = servedBuild({
    running: RUNNING,
    fetcher,
    clock,
    visibility: {
      current: () => state,
      onChange: (listener) => {
        listeners.add(listener)

        return () => listeners.delete(listener)
      },
    },
  })

  return {
    fetcher,
    clock,
    heard,
    start: () => watch.watch((served) => heard.push(served)),
    serve: (next: () => Promise<Response>) => {
      answer = next
    },
    show: (next: Visibility) => {
      state = next

      for (const listener of listeners) {
        listener(next)
      }
    },
  }
}

function manifest(product: Build): Promise<Response> {
  return Promise.resolve(
    new Response(JSON.stringify({ manifestVersion: 1, product: { name: 'perch', ...product } })),
  )
}

describe('servedBuild', () => {
  it('hears nothing while the server serves the build this tab runs, and a newer one once the tab comes back', async () => {
    const page = tab()

    page.start()
    await settle()

    expect(page.fetcher).toHaveBeenCalledWith('/ui-manifest/manifest.json', { cache: 'no-store' })
    expect(page.heard).toEqual([])

    page.serve(() => manifest(NEWER))
    page.show('hidden')
    page.show('visible')
    await settle()

    expect(page.heard).toEqual([`0.1.0+${'b'.repeat(40)}`])

    // Heard once: the frame says it until the page loads again, so nothing reads any more.
    const reads = page.fetcher.mock.calls.length

    page.show('visible')
    await page.clock.advance(TEN_MINUTES)

    expect(page.fetcher).toHaveBeenCalledTimes(reads)
    expect(page.heard).toHaveLength(1)
  })

  it('reads the manifest every ten minutes while the tab is in the foreground, never in the background', async () => {
    const page = tab()

    page.start()
    await settle()
    await page.clock.advance(TEN_MINUTES)

    expect(page.fetcher).toHaveBeenCalledTimes(2)

    page.show('hidden')
    await page.clock.advance(TEN_MINUTES)

    expect(page.fetcher).toHaveBeenCalledTimes(2)

    page.serve(() => manifest({ version: '0.2.0', commit: RUNNING.commit }))
    page.show('visible')
    await settle()

    expect(page.heard).toEqual([`0.2.0+${'a'.repeat(40)}`])
  })

  it('says nothing for a manifest the server does not serve, one that does not read, or a failed read', async () => {
    const page = tab()

    page.serve(() => Promise.resolve(new Response('Not Found', { status: 404 })))
    page.start()
    await settle()
    page.serve(() => Promise.resolve(new Response(JSON.stringify({ product: { version: 1 } }))))
    page.show('visible')
    await settle()
    page.serve(() => Promise.reject(new TypeError('the network is down')))
    page.show('visible')
    await settle()

    expect(page.fetcher).toHaveBeenCalledTimes(3)
    expect(page.heard).toEqual([])
  })

  it('reads nothing more once stopped', async () => {
    const page = tab()
    const stop = page.start()

    await settle()
    stop()
    page.serve(() => manifest(NEWER))
    page.show('visible')
    await page.clock.advance(TEN_MINUTES)

    expect(page.fetcher).toHaveBeenCalledOnce()
    expect(page.clock.pending()).toBe(0)
    expect(page.heard).toEqual([])
  })
})
