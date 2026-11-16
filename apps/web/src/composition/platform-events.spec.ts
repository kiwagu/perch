import { describe, expect, it } from 'vitest'

import type { PlatformEvent } from '../platform/platform-events.port'

import { platformEvents } from './platform-events'
import { memoryStorage, PASSWORD_RESET_KEY, savePasswordReset } from './storage'

/** The events a fresh listener on `storage` hears, and its stop. */
function listening(storage: ReturnType<typeof memoryStorage>) {
  const heard: PlatformEvent[] = []
  const stop = platformEvents(storage).listen((event) => heard.push(event))

  return { heard, stop }
}

describe('the platform events of this browser', () => {
  it('tells a password reset each time another tab sets its key', () => {
    const storage = memoryStorage()
    const { heard } = listening(storage)

    storage.changeElsewhere(PASSWORD_RESET_KEY, 'first')
    storage.changeElsewhere(PASSWORD_RESET_KEY, 'second')

    expect(heard).toEqual([
      { type: 'platform.password-reset' },
      { type: 'platform.password-reset' },
    ])
  })

  it("tells nothing of this tab's own reset, of a value kept before, or of another key", () => {
    const storage = memoryStorage()

    savePasswordReset(storage)

    const { heard } = listening(storage)

    savePasswordReset(storage)
    storage.changeElsewhere('perch.session.notice.0.signed-out-elsewhere', 'signed-out-elsewhere')

    expect(heard).toEqual([])
  })

  it('tells a theme each time another tab chooses one', () => {
    const storage = memoryStorage()
    const { heard } = listening(storage)

    storage.changeElsewhere('perch.theme', 'dark')
    storage.changeElsewhere('perch.theme', 'light')

    expect(heard).toEqual([{ type: 'platform.theme-set' }, { type: 'platform.theme-set' }])
  })

  it('tells nothing when another tab removes the key', () => {
    const storage = memoryStorage()
    const { heard } = listening(storage)

    storage.changeElsewhere(PASSWORD_RESET_KEY, undefined)

    expect(heard).toEqual([])
  })

  it('stops telling once the listener stops', () => {
    const storage = memoryStorage()
    const { heard, stop } = listening(storage)

    stop()
    storage.changeElsewhere(PASSWORD_RESET_KEY, 'first')

    expect(heard).toEqual([])
  })
})
