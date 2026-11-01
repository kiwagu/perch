import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * Every text tone of the theme reads at 4.5:1 or more (WCAG 2, AA for body text) on the theme's
 * card and background, in light and in dark, so a token edit that breaks one fails here.
 */

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'global.css'), 'utf8')

const AA_TEXT = 4.5
const TEXT_TONES = [
  'foreground',
  'muted-foreground',
  'success',
  'warning',
  'info',
  'destructive',
] as const
const SURFACES = ['card', 'background'] as const

type Theme = 'light' | 'dark'
type Oklch = readonly [lightness: number, chroma: number, hue: number]
type Rgb = readonly [red: number, green: number, blue: number]

/** The body of the rule a line of global.css opens with `selector {`. */
function blockOf(selector: string): string {
  const start = CSS.indexOf(`\n${selector} {`)

  if (start === -1) throw new Error(`global.css has no rule for ${selector}`)

  return CSS.slice(start, CSS.indexOf('\n}', start))
}

/** Dark is a class on <html>: it overrides some of :root's tokens and inherits the others. */
const BLOCKS: Readonly<Record<Theme, readonly string[]>> = {
  light: [blockOf(':root')],
  dark: [blockOf('.dark'), blockOf(':root')],
}

function colorOf(theme: Theme, name: string): Oklch {
  const pattern = new RegExp(`--${name}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`)

  for (const block of BLOCKS[theme]) {
    const match = pattern.exec(block)

    if (match !== null) return [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  throw new Error(`global.css sets no opaque oklch --${name} for the ${theme} theme`)
}

/** OKLCH to linear sRGB, through OKLab's own matrices. */
function linearSrgb([lightness, chroma, hue]: Oklch): Rgb {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
}

/** WCAG 2 relative luminance of the colour, clipped to the sRGB gamut as a screen shows it. */
function luminance(color: Oklch): number {
  const clip = (channel: number) => Math.min(1, Math.max(0, channel))
  const [red, green, blue] = linearSrgb(color)

  return 0.2126 * clip(red) + 0.7152 * clip(green) + 0.0722 * clip(blue)
}

function contrast(text: Oklch, surface: Oklch): number {
  const ofText = luminance(text)
  const ofSurface = luminance(surface)

  return (Math.max(ofText, ofSurface) + 0.05) / (Math.min(ofText, ofSurface) + 0.05)
}

describe('the theme tokens', () => {
  it('measure contrast as WCAG 2 does', () => {
    expect(contrast([0, 0, 0], [1, 0, 0])).toBeCloseTo(21, 2)
    // Tailwind's green-600 (#00a63e) and neutral-500 (#737373) on white, from the oklch values
    // before they are rounded to a hex.
    expect(contrast([0.627, 0.194, 149.214], [1, 0, 0])).toBeCloseTo(3.22, 2)
    expect(contrast([0.556, 0, 0], [1, 0, 0])).toBeCloseTo(4.73, 2)
  })

  it.each(
    (['light', 'dark'] as const).flatMap((theme) =>
      TEXT_TONES.flatMap((tone) => SURFACES.map((surface) => [theme, tone, surface] as const)),
    ),
  )('make a %s %s text read at 4.5:1 or more on the %s', (theme, tone, surface) => {
    expect(contrast(colorOf(theme, tone), colorOf(theme, surface))).toBeGreaterThanOrEqual(AA_TEXT)
  })
})
