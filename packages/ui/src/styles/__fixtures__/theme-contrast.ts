/**
 * Measuring the theme of `global.css` as a screen shows it: a token's colour in a theme, a tint
 * (`bg-x/N`) painted on a surface, the WCAG 2 contrast between two colours and how far apart two
 * colours look.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

type Theme = 'light' | 'dark'
type Oklch = readonly [lightness: number, chroma: number, hue: number]
/** Gamma-encoded sRGB, each channel clipped to 0..1 as a screen clips it. */
type Rgb = readonly [red: number, green: number, blue: number]

const THEMES: readonly Theme[] = ['light', 'dark']
/** WCAG 2, AA, for text below the large sizes. */
const AA_TEXT = 4.5
/** An OKLab distance of about 0.02 is just noticeable; a state change shows at half as much again. */
const NOTICEABLE = 0.03

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'global.css'), 'utf8')

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

const encode = (linear: number) =>
  linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055
const decode = (channel: number) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
const clip = (channel: number) => Math.min(1, Math.max(0, channel))

function fromOklch([lightness, chroma, hue]: Oklch): Rgb {
  const a = chroma * Math.cos((hue * Math.PI) / 180)
  const b = chroma * Math.sin((hue * Math.PI) / 180)
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    clip(encode(clip(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s))),
    clip(encode(clip(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s))),
    clip(encode(clip(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s))),
  ]
}

function toOklab([red, green, blue]: Rgb): readonly [number, number, number] {
  const [r, g, b] = [decode(red), decode(green), decode(blue)]
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** The colour `--<token>` takes in the theme. */
function themeColor(theme: Theme, token: string): Rgb {
  const pattern = new RegExp(`--${token}:\\s*oklch\\(([\\d.]+) ([\\d.]+) ([\\d.]+)\\);`)

  for (const block of BLOCKS[theme]) {
    const match = pattern.exec(block)

    if (match !== null) return fromOklch([Number(match[1]), Number(match[2]), Number(match[3])])
  }
  throw new Error(`global.css sets no opaque oklch --${token} for the ${theme} theme`)
}

/** `color` at `percent` painted on `surface`: what a `bg-x/N` utility shows. */
function over(color: Rgb, surface: Rgb, percent: number): Rgb {
  const alpha = percent / 100

  return [
    alpha * color[0] + (1 - alpha) * surface[0],
    alpha * color[1] + (1 - alpha) * surface[1],
    alpha * color[2] + (1 - alpha) * surface[2],
  ]
}

function luminance([red, green, blue]: Rgb): number {
  return 0.2126 * decode(red) + 0.7152 * decode(green) + 0.0722 * decode(blue)
}

/** The WCAG 2 contrast ratio between two colours. */
function contrast(first: Rgb, second: Rgb): number {
  const [a, b] = [luminance(first), luminance(second)]

  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** How far apart two colours look: their distance in OKLab. */
function difference(first: Rgb, second: Rgb): number {
  const [a, b] = [toOklab(first), toOklab(second)]

  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * The percent of the tint a class list paints with `utility` (`hover:bg-destructive`) in the
 * theme: in dark, its `dark:` form when it has one.
 */
function tintOf(classes: readonly string[], utility: string, theme: Theme): number {
  const forms = theme === 'dark' ? [`dark:${utility}/`, `${utility}/`] : [`${utility}/`]

  for (const form of forms) {
    const found = classes.find((name) => name.startsWith(form))

    if (found !== undefined) return Number(found.slice(form.length))
  }
  throw new Error(`no ${utility}/<percent> paints the ${theme} theme in: ${classes.join(' ')}`)
}

export {
  AA_TEXT,
  contrast,
  difference,
  fromOklch,
  NOTICEABLE,
  over,
  type Rgb,
  THEMES,
  type Theme,
  themeColor,
  tintOf,
}
