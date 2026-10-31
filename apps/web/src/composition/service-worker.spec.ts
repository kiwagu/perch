import { beforeEach, describe, expect, it, vi } from 'vitest'

import { serviceWorkerReload } from './service-worker'

const registered = vi.hoisted(() => ({
  options: undefined as undefined | { onNeedRefresh?: () => void; onNeedReload?: () => void },
  update: vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve()),
}))

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh?: () => void; onNeedReload?: () => void }) => {
    registered.options = options

    return registered.update
  },
}))

/** A page whose reload the test sees. */
function page() {
  const reload = vi.fn()
  const window = {
    location: { reload },
    document: new EventTarget(),
  } as unknown as Window

  return { window, reload }
}

describe('serviceWorkerReload', () => {
  beforeEach(() => {
    registered.update.mockClear()
  })

  it('loads the page again itself while no newer worker waits', () => {
    const tab = page()
    const reload = serviceWorkerReload(tab.window)

    reload()

    expect(tab.reload).toHaveBeenCalledOnce()
    expect(registered.update).not.toHaveBeenCalled()
  })

  it('lets a waiting newer worker take over, then loads the page again once it has', () => {
    const tab = page()
    const reload = serviceWorkerReload(tab.window)

    registered.options?.onNeedRefresh?.()
    reload()

    expect(registered.update).toHaveBeenCalledWith(true)
    expect(tab.reload).not.toHaveBeenCalled()

    registered.options?.onNeedReload?.()

    expect(tab.reload).toHaveBeenCalledOnce()
  })

  it("keeps a tab as it is when another tab's reload let the newer worker take over", () => {
    const tab = page()
    const reload = serviceWorkerReload(tab.window)

    registered.options?.onNeedRefresh?.()
    // Another tab asked: the newer worker controls this tab too, which holds unsaved input.
    registered.options?.onNeedReload?.()

    expect(tab.reload).not.toHaveBeenCalled()

    // Its own reload, asked later through the frame's guard, is a plain one.
    reload()

    expect(registered.update).not.toHaveBeenCalled()
    expect(tab.reload).toHaveBeenCalledOnce()
  })
})
