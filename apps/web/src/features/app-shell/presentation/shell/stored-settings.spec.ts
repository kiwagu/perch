import { describe, expect, it, vi } from 'vitest'

import type { Theme } from '../../../../platform/theme'

import { openedFrame } from './__fixtures__/frame'
import { frameSettingsWrites } from './shell-frame'
import { deliverStored } from './stored-settings'

/**
 * A signed-in account's frame, opened, whose install prompt waits until the test ends it; what it
 * spoke and showed, and the settings it holds as the shape gives them.
 */
function frameOfAnn() {
  let endPrompt = () => {}
  const setTheme = vi.fn<(theme: Theme) => void>()
  const frame = openedFrame({
    setTheme,
    install: {
      prompt: () =>
        new Promise<void>((resolve) => {
          endPrompt = resolve
        }),
      postpone: () => {},
    },
  })
  const spoken: string[] = []

  frame.live.account = 'idn_ann'
  frame.actor.on('speak', ({ locale }) => spoken.push(locale))

  return {
    frame,
    setTheme,
    spoken,
    /** The settings as the shape gives them now, handed to the frame as the shell does. */
    hold: (locale: string, theme: string) => {
      frame.live.stored = { locale, theme }
      deliverStored(frame, 'locale', locale)
      deliverStored(frame, 'theme', theme)
    },
    /** The frame moved: the shell hands what it holds again. */
    moved: () => {
      deliverStored(frame, 'locale', frame.live.stored?.locale)
      deliverStored(frame, 'theme', frame.live.stored?.theme)
    },
    install: () => frame.actor.send({ type: 'app-shell.install-button' }),
    endPrompt: () => endPrompt(),
  }
}

describe('deliverStored', () => {
  it('applies a language and a theme stored elsewhere while the app installs, once the frame is back', async () => {
    const ann = frameOfAnn()

    ann.hold('en', 'light')

    expect(ann.spoken).toEqual(['en'])
    expect(ann.setTheme.mock.calls).toEqual([['light']])

    ann.install()
    ann.hold('es', 'dark')

    expect(ann.frame.actor.getSnapshot().matches('installing')).toBe(true)
    expect(ann.spoken).toEqual(['en'])
    expect(ann.setTheme.mock.calls).toEqual([['light']])

    ann.endPrompt()
    await vi.waitFor(() => expect(ann.frame.actor.getSnapshot().matches('ready')).toBe(true))
    ann.moved()

    expect(ann.spoken).toEqual(['en', 'es'])
    expect(ann.setTheme.mock.calls).toEqual([['light'], ['dark']])

    // Handed again on a later move, it is seen: nothing applies twice.
    ann.moved()

    expect(ann.spoken).toEqual(['en', 'es'])
    expect(ann.setTheme.mock.calls).toEqual([['light'], ['dark']])
  })

  it("never takes this tab's own write for one stored elsewhere, while the app installs or after", async () => {
    const ann = frameOfAnn()
    const writes = frameSettingsWrites(ann.frame.live)

    ann.hold('en', 'light')
    ann.install()
    // The settings screen of this tab stores dark and es; they come back while the app installs.
    writes.theme.writing('dark')
    writes.locale.writing('es')
    ann.hold('es', 'dark')
    ann.endPrompt()
    await vi.waitFor(() => expect(ann.frame.actor.getSnapshot().matches('ready')).toBe(true))
    ann.moved()

    expect(ann.spoken).toEqual(['en'])
    expect(ann.setTheme.mock.calls).toEqual([['light']])

    // Its own writes came back and are no longer on their way: another tab's values apply.
    ann.hold('en', 'light')
    ann.hold('es', 'dark')

    expect(ann.spoken).toEqual(['en', 'en', 'es'])
    expect(ann.setTheme.mock.calls).toEqual([['light'], ['light'], ['dark']])
  })

  it('hands nothing before the settings arrive', () => {
    const ann = frameOfAnn()

    ann.moved()

    expect(ann.spoken).toEqual([])
    expect(ann.setTheme).not.toHaveBeenCalled()
  })
})
