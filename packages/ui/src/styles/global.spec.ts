import { describe, expect, it } from 'vitest'

import { AA_TEXT, contrast, fromOklch, THEMES, themeColor } from './__fixtures__/theme-contrast'

/**
 * Every text tone of the theme reads at 4.5:1 or more on the theme's card and background, in
 * light and in dark, so a token edit that breaks one fails here.
 */

const TEXT_TONES = [
  'foreground',
  'muted-foreground',
  'success',
  'warning',
  'info',
  'destructive',
] as const
const SURFACES = ['card', 'background'] as const

describe('the theme tokens', () => {
  it('measure contrast as WCAG 2 does', () => {
    const white = fromOklch([1, 0, 0])

    expect(contrast(fromOklch([0, 0, 0]), white)).toBeCloseTo(21, 2)
    // Tailwind's green-600 (#00a63e) and neutral-500 (#737373) on white, from the oklch values
    // before they are rounded to a hex.
    expect(contrast(fromOklch([0.627, 0.194, 149.214]), white)).toBeCloseTo(3.22, 2)
    expect(contrast(fromOklch([0.556, 0, 0]), white)).toBeCloseTo(4.73, 2)
  })

  it.each(
    THEMES.flatMap((theme) =>
      TEXT_TONES.flatMap((tone) => SURFACES.map((surface) => [theme, tone, surface] as const)),
    ),
  )('make a %s %s text read at 4.5:1 or more on the %s', (theme, tone, surface) => {
    expect(contrast(themeColor(theme, tone), themeColor(theme, surface))).toBeGreaterThanOrEqual(
      AA_TEXT,
    )
  })
})
