import { beforeEach, describe, expect, it, vi } from 'vitest'

import { serviceWorkerReload } from './service-worker'

const registered = vi.hoisted(() => ({
  options: undefined as undefined | { onNeedRefresh?: () => void },
  update: vi.fn<(reloadPage?: boolean) => Promise<void>>(() => Promise.resolve()),
}))

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh?: () => void }) => {
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

  it('lets a waiting newer worker take over, which loads the page again', () => {
    const tab = page()
    const reload = serviceWorkerReload(tab.window)

    registered.options?.onNeedRefresh?.()
    reload()

    expect(registered.update).toHaveBeenCalledWith(true)
    expect(tab.reload).not.toHaveBeenCalled()
  })
})
