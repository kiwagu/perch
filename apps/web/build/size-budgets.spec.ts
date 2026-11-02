import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { measureBuild, type SizeBudgets } from './size-budgets'

const BUDGETS: SizeBudgets = {
  firstFrame: 3000,
  lazyScript: 1500,
  wasm: [{ engine: 'Engine', file: /^engine_bg-\w+\.wasm$/, budget: 2500 }],
}

const PAGE =
  '<script type="module" src="/assets/index-c3.js"></script><link rel="stylesheet" href="/assets/index-d4.css">'

const STYLES = [
  '@font-face{font-family:Sans;src:url(/assets/sans-cyrillic-a1.woff2)format("woff2");unicode-range:U+400-45F}',
  '@font-face{font-family:Sans;src:url(/assets/sans-latin-b2.woff2)format("woff2");unicode-range:U+??,U+131}',
].join('')

let dist = ''

/**
 * A build of the page, its entry script, stylesheet and fonts, and `files`, each by its path in
 * the build: a number is so many random bytes, which do not compress, so its gzipped size is a
 * little over its own; a string is the file's text.
 */
function build(files: Record<string, number | string>): string {
  dist = mkdtempSync(join(tmpdir(), 'size-budgets-'))

  for (const [file, contents] of Object.entries({
    'index.html': PAGE,
    'assets/index-d4.css': STYLES,
    'assets/index-c3.js': 100,
    'assets/sans-latin-b2.woff2': 100,
    'assets/sans-cyrillic-a1.woff2': 100,
    ...files,
  })) {
    mkdirSync(dirname(join(dist, file)), { recursive: true })
    writeFileSync(join(dist, file), typeof contents === 'number' ? randomBytes(contents) : contents)
  }

  return dist
}

const over = (measures: ReturnType<typeof measureBuild>) =>
  measures.filter(({ size, budget }) => size > budget).map(({ what }) => what)

afterEach(() => rmSync(dist, { recursive: true, force: true }))

describe('measureBuild', () => {
  it("counts the page's scripts, styles and Basic Latin font on the first frame, and the rest apart", () => {
    const measures = measureBuild(
      build({
        'assets/sans-latin-b2.woff2': 2000,
        'assets/sans-cyrillic-a1.woff2': 2000,
        'assets/lazy-e5.js': 1000,
        'assets/engine_bg-f6.wasm': 2000,
      }),
      BUDGETS,
    )

    expect(measures.map(({ what }) => what)).toEqual([
      'first frame',
      'lazy script /assets/lazy-e5.js',
      'Engine WASM /assets/engine_bg-f6.wasm',
    ])
    expect(measures[0]?.size).toBeGreaterThan(2100)
    // The Cyrillic face is not drawn for a page in a Latin script.
    expect(measures[0]?.size).toBeLessThan(3000)
    expect(over(measures)).toEqual([])
  })

  it('finds the first frame, a lazy script and a WASM module over their budgets', () => {
    const measures = measureBuild(
      build({
        'assets/sans-latin-b2.woff2': 3000,
        'assets/lazy-e5.js': 1600,
        'assets/engine_bg-f6.wasm': 2600,
      }),
      BUDGETS,
    )

    expect(over(measures)).toEqual([
      'first frame',
      'lazy script /assets/lazy-e5.js',
      'Engine WASM /assets/engine_bg-f6.wasm',
    ])
  })

  it('counts the startup files outside the assets on the first frame, and a lazy script there apart', () => {
    const measures = measureBuild(
      build({
        'index.html': `${PAGE}<script src=/startup.js></script><link href='startup.css' rel="preload stylesheet"><link rel="icon" href="/icon.svg">`,
        'startup.js': 1500,
        'startup.css': 1500,
        'icon.svg': 5000,
        'sw.js': 1600,
      }),
      BUDGETS,
    )

    expect(measures.map(({ what }) => what)).toEqual(['first frame', 'lazy script /sw.js'])
    // The icon is no startup file: only the scripts and the stylesheets push the frame over.
    expect(measures[0]?.size).toBeLessThan(5000)
    expect(over(measures)).toEqual(['first frame', 'lazy script /sw.js'])
  })

  it("reads a font's address from where its stylesheet is, and counts no font held inside it", () => {
    const measures = measureBuild(
      build({
        'assets/index-d4.css':
          '@font-face{src:url(../fonts/sans-latin.woff2)}@font-face{src:url(data:font/woff2;base64,AAAA)}',
        'fonts/sans-latin.woff2': 3000,
      }),
      BUDGETS,
    )

    expect(over(measures)).toEqual(['first frame'])
  })

  it('fails a WASM module that no engine claims', () => {
    expect(over(measureBuild(build({ 'assets/other_bg-a7.wasm': 10 }), BUDGETS))).toEqual([
      'unbudgeted WASM /assets/other_bg-a7.wasm',
    ])
  })
})
