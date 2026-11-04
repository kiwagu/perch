import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { Locale } from '@workspace/i18n'

import { trackedStore } from './settings-writes'

function record() {
  const events: string[] = []

  return {
    events,
    writes: {
      writing: (locale: Locale) => {
        events.push(`writing ${locale}`)

        return () => {
          events.push(`failed ${locale}`)
        }
      },
    },
  }
}

describe('trackedStore', () => {
  it('says a write before its store starts, and nothing more once it is stored', async () => {
    const { events, writes } = record()
    const store = trackedStore(writes, (locale) => {
      events.push(`store ${locale}`)

      return okAsync(undefined)
    })

    expect((await store('es')).isOk()).toBe(true)
    expect(events).toEqual(['writing es', 'store es'])
  })

  it('says a write that failed, so its value is not taken for one coming back', async () => {
    const { events, writes } = record()
    const store = trackedStore(writes, () => errAsync(new Error('refused')))

    expect((await store('en')).isErr()).toBe(true)
    expect(events).toEqual(['writing en', 'failed en'])
  })
})
