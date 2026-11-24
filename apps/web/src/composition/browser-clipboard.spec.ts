import { describe, expect, it, vi } from 'vitest'

import { browserClipboard } from './browser-clipboard'

describe('browserClipboard', () => {
  it('writes the text through the browser', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    const written = await browserClipboard({ writeText } as unknown as Clipboard).write(
      'https://x/y',
    )

    expect(written.isOk()).toBe(true)
    expect(writeText).toHaveBeenCalledWith('https://x/y')
  })

  it("fails with the browser's refusal, naming it", async () => {
    const written = await browserClipboard({
      writeText: () => Promise.reject(new Error('not allowed')),
    } as unknown as Clipboard).write('https://x/y')

    expect(written._unsafeUnwrapErr().code).toBe('clipboard:REFUSED')
  })

  it('fails naming the missing capability when the page has no clipboard', async () => {
    const written = await browserClipboard(undefined).write('https://x/y')

    const error = written._unsafeUnwrapErr()

    expect(error.code).toBe('clipboard:UNAVAILABLE')
    expect(error.message).toContain('clipboard')
  })
})
