/**
 * The production build's size budgets, checked once the build is written: a build over any of
 * them fails, so a first frame that grows, a lazy script that swells, or an engine that grows on
 * an upgrade (or is bundled twice) stops the build, the e2e launcher's and a deploy's included.
 * Sizes are gzipped, a stable measure of what travels (the front compresses with zstd, which
 * does a little better). The first frame is what the page loads before it can paint: the page,
 * the scripts, preloads and stylesheets it names, wherever they are in the build (the entry, its
 * preloaded chunks, the stylesheet), and the font faces those styles declare for Basic Latin,
 * which every catalog of the app is written in. Every other script of the build is a lazy
 * script, and each WASM module has the budget of its engine; a module no engine claims fails the
 * build until it has one. Raising a budget is a change to this file.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { gzipSync } from 'node:zlib'

import type { Plugin } from 'vite'

const KB = 1024
const MB = 1024 * KB

export interface SizeBudgets {
  readonly firstFrame: number
  readonly lazyScript: number
  readonly wasm: readonly {
    readonly engine: string
    readonly file: RegExp
    readonly budget: number
  }[]
}

export const SIZE_BUDGETS: SizeBudgets = {
  firstFrame: 310 * KB,
  lazyScript: 100 * KB,
  wasm: [
    { engine: 'SurrealDB', file: /^index_bg-[\w-]+\.wasm$/, budget: 5.2 * MB },
    { engine: 'Loro', file: /^loro_wasm_bg-[\w-]+\.wasm$/, budget: 1.2 * MB },
  ],
}

/** One measured part of the build against its budget, in gzipped bytes. */
export interface SizeMeasure {
  readonly what: string
  readonly size: number
  readonly budget: number
}

/** The letter every catalog of the app begins with: a font face that covers it is drawn first. */
const LATIN = 0x41

/** Whether a CSS `unicode-range` (`U+41`, `U+0-FF`, `U+??`) covers `code`. */
function covers(range: string, code: number): boolean {
  return range.split(',').some((part) => {
    const [from = '', to = from] = part.trim().replace(/^U\+/i, '').split('-')
    const low = Number.parseInt(from.replaceAll('?', '0'), 16)
    const high = Number.parseInt(to.replaceAll('?', 'F'), 16)

    return low <= code && code <= high
  })
}

/** The page's origin, against which the build's addresses resolve. */
const PAGE = new URL('https://page.invalid/')

/** The file of the build that `address` names from `from`; none for another origin or `data:`. */
function inBuild(address: string, from: URL): string | undefined {
  const url = new URL(address, from)

  return url.origin === PAGE.origin ? decodeURIComponent(url.pathname) : undefined
}

/** The links that load a file before the page paints. */
const STARTUP_LINKS = new Set(['stylesheet', 'modulepreload', 'preload'])

/** The files a page loads before it paints: its scripts, preloads and stylesheets. */
function startupOf(page: string): string[] {
  return [...page.matchAll(/<(script|link)\b([^>]*)>/gi)].flatMap(
    ([, tag = '', attributes = '']) => {
      const attribute = (name: string) =>
        new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i')
          .exec(attributes)
          ?.slice(1)
          .find((value) => value !== undefined)
      const startup =
        tag.toLowerCase() === 'script'
          ? attribute('src')
          : (attribute('rel') ?? '')
                .toLowerCase()
                .split(/\s+/)
                .some((rel) => STARTUP_LINKS.has(rel))
            ? attribute('href')
            : undefined
      const file = startup === undefined ? undefined : inBuild(startup, PAGE)

      return file === undefined ? [] : [file]
    },
  )
}

/** The files a stylesheet's Basic Latin font faces load, its addresses read from where it is. */
function latinFonts(css: string, from: URL): string[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].flatMap(([, face = '']) => {
    const range = /unicode-range:\s*([^;}]+)/.exec(face)?.[1]

    return range === undefined || covers(range, LATIN)
      ? [...face.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].flatMap(([, url = '']) => {
          const file = inBuild(url, from)

          return file === undefined ? [] : [file]
        })
      : []
  })
}

/** Every part of the build in `dist` measured against `budgets`. */
export function measureBuild(dist: string, budgets: SizeBudgets = SIZE_BUDGETS): SizeMeasure[] {
  const gzipped = (file: string) => gzipSync(readFileSync(join(dist, file))).length
  const startup = startupOf(readFileSync(join(dist, 'index.html'), 'utf8'))
  const fonts = startup
    .filter((file) => file.endsWith('.css'))
    .flatMap((file) => latinFonts(readFileSync(join(dist, file), 'utf8'), new URL(file, PAGE)))
  const firstFrame = new Set([...startup, ...fonts])
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).map(
    (file) => `/${file.split(sep).join('/')}`,
  )
  const lazy = files.filter((file) => file.endsWith('.js') && !firstFrame.has(file))
  const modules = files.filter((file) => file.endsWith('.wasm'))

  return [
    {
      what: 'first frame',
      size: [...firstFrame].reduce((sum, file) => sum + gzipped(file), gzipped('index.html')),
      budget: budgets.firstFrame,
    },
    ...lazy.map((file) => ({
      what: `lazy script ${file}`,
      size: gzipped(file),
      budget: budgets.lazyScript,
    })),
    ...modules.map((file) => {
      const name = file.slice(file.lastIndexOf('/') + 1)
      const engine = budgets.wasm.find(({ file: pattern }) => pattern.test(name))

      return {
        what: `${engine?.engine ?? 'unbudgeted'} WASM ${file}`,
        size: gzipped(file),
        budget: engine?.budget ?? 0,
      }
    }),
  ]
}

const kb = (bytes: number) =>
  bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : `${(bytes / KB).toFixed(1)} kB`

/** Fails a production build over any of the budgets, and says how close it came otherwise. */
export function sizeBudgets(budgets: SizeBudgets = SIZE_BUDGETS): Plugin {
  let dist = ''
  let info: (message: string) => void = () => undefined

  return {
    name: 'perch:size-budgets',
    apply: (_, env) => env.command === 'build' && env.mode === 'production',
    configResolved(config) {
      dist = resolve(config.root, config.build.outDir)
      info = (message) => config.logger.info(message)
    },
    writeBundle() {
      const measures = measureBuild(dist, budgets)
      const over = measures.filter(({ size, budget }) => size > budget)

      if (over.length > 0) {
        this.error(
          `the build is over its size budgets (gzipped, apps/web/build/size-budgets.ts):\n${over
            .map(({ what, size, budget }) => `  ${what}: ${kb(size)} of ${kb(budget)}`)
            .join('\n')}`,
        )
      }

      const largest = (prefix: string) =>
        measures
          .filter(({ what }) => what.startsWith(prefix))
          .reduce<SizeMeasure | undefined>(
            (top, measure) => (top && top.size >= measure.size ? top : measure),
            undefined,
          )

      info(
        `size budgets (gzipped): ${[
          largest('first frame'),
          largest('lazy script'),
          ...budgets.wasm.map(({ engine }) => largest(engine)),
        ]
          .filter((measure) => measure !== undefined)
          .map(
            ({ what, size, budget }) =>
              `${what.replace(/ \/assets\/.*/, '')} ${kb(size)} of ${kb(budget)}`,
          )
          .join(', ')}`,
      )
    },
  }
}
