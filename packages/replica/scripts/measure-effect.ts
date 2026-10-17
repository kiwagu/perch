/**
 * Compares the cadence and the outbox drain written with the light layer against the versions
 * written on Effect. Builds one browser entry per version with Vite (target esnext, minified) in a
 * temporary directory; each entry wires a cadence and a drain over the system clock the way the
 * sync engine does. Prints each build's chunks raw and gzipped, the difference, how much of
 * Effect reaches the Effect build, and the lines of both implementations without blank and
 * comment lines.
 *
 * Usage: bun run measure:effect [work directory]   (a new temporary directory by default)
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

import { build, type Rolldown } from 'vite'

const SOURCE = resolve(import.meta.dir, '../src')

interface Variant {
  readonly name: string
  readonly cadence: { readonly file: string; readonly factory: string }
  readonly drain: { readonly file: string; readonly factory: string }
}

const VARIANTS: readonly Variant[] = [
  {
    name: 'light',
    cadence: { file: 'sync/cadence.ts', factory: 'createCadence' },
    drain: { file: 'sync/outbox-drain.ts', factory: 'createOutboxDrain' },
  },
  {
    name: 'effect',
    cadence: { file: 'sync/cadence.effect.ts', factory: 'createEffectCadence' },
    drain: { file: 'sync/outbox-drain.effect.ts', factory: 'createEffectOutboxDrain' },
  },
]

interface Chunk {
  readonly fileName: string
  readonly raw: number
  readonly gzip: number
}

interface Measured {
  readonly chunks: readonly Chunk[]
  /** Rendered bytes before minification, of Effect's modules and of all modules. */
  readonly effectRendered: number
  readonly allRendered: number
  readonly effectModules: number
}

function entryOf(variant: Variant): string {
  const at = (file: string): string => JSON.stringify(join(SOURCE, file))

  return [
    `import { systemClock } from ${at('clock.ts')}`,
    `import { ${variant.cadence.factory} } from ${at(variant.cadence.file)}`,
    `import { ${variant.drain.factory} } from ${at(variant.drain.file)}`,
    `const drain = ${variant.drain.factory}({ pushNext: () => Promise.resolve('empty') })`,
    `const cadence = ${variant.cadence.factory}(systemClock, async () => {`,
    '  drain.request()',
    '  await drain.idle()',
    '})',
    'globalThis.sync = { cadence, drain }',
    '',
  ].join('\n')
}

function isEffectModule(id: string): boolean {
  return id.includes('/node_modules/effect/') || id.includes('/node_modules/.bun/effect@')
}

async function measure(variant: Variant, workDir: string): Promise<Measured> {
  const dir = join(workDir, variant.name)
  const entry = join(dir, 'entry.js')

  mkdirSync(dir, { recursive: true })
  writeFileSync(entry, entryOf(variant))

  const built = await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    build: {
      target: 'esnext',
      minify: true,
      modulePreload: false,
      outDir: join(dir, 'dist'),
      emptyOutDir: true,
      rolldownOptions: { input: entry },
    },
  })

  if (Array.isArray(built) || !('output' in built)) {
    throw new Error(`the ${variant.name} build did not return one output`)
  }

  const chunks = built.output.filter((item): item is Rolldown.OutputChunk => item.type === 'chunk')
  const modules = chunks.flatMap((chunk) => Object.entries(chunk.modules))
  const effect = modules.filter(([id]) => isEffectModule(id))
  const rendered = (entries: typeof modules): number =>
    entries.reduce((sum, [, module]) => sum + module.renderedLength, 0)

  return {
    chunks: chunks.map((chunk) => ({
      fileName: chunk.fileName,
      raw: Buffer.byteLength(chunk.code),
      gzip: gzipSync(chunk.code).byteLength,
    })),
    effectRendered: rendered(effect),
    allRendered: rendered(modules),
    effectModules: effect.filter(([, module]) => module.renderedLength > 0).length,
  }
}

/** The JavaScript files of the installed Effect package and their total size. */
function effectDist(): { readonly files: number; readonly bytes: number } {
  const dist = dirname(fileURLToPath(import.meta.resolve('effect')))
  const files = readdirSync(dist, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.js'),
  )

  return {
    files: files.length,
    bytes: files.reduce((sum, file) => sum + statSync(join(dist, file)).size, 0),
  }
}

/** Lines that are neither blank nor comments. */
function codeLines(file: string): number {
  return readFileSync(join(SOURCE, file), 'utf8')
    .split('\n')
    .filter((line) => {
      const text = line.trim()

      return text !== '' && !/^(\/\/|\/\*|\*)/.test(text)
    }).length
}

const sum = (chunks: readonly Chunk[], key: 'raw' | 'gzip'): number =>
  chunks.reduce((total, chunk) => total + chunk[key], 0)

const signed = (value: number): string => (value >= 0 ? `+${value}` : String(value))

const workDir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'effect-measure-'))
const results: Measured[] = []

console.log(`work directory: ${workDir}`)

for (const variant of VARIANTS) {
  const measured = await measure(variant, workDir)

  results.push(measured)

  for (const chunk of measured.chunks) {
    console.log(`${variant.name}: ${chunk.fileName}: ${chunk.raw} B raw, ${chunk.gzip} B gzip`)
  }
}

const [light, effect] = results

if (!light || !effect) {
  throw new Error('both builds must be measured')
}

const dist = effectDist()

console.log(
  `difference (effect - light): ${signed(sum(effect.chunks, 'raw') - sum(light.chunks, 'raw'))} B raw, ` +
    `${signed(sum(effect.chunks, 'gzip') - sum(light.chunks, 'gzip'))} B gzip`,
)
console.log(
  `Effect in the effect build, before minification: ${effect.effectRendered} of ` +
    `${effect.allRendered} rendered bytes (` +
    `${Math.round((effect.effectRendered / effect.allRendered) * 1000) / 10}%), from ` +
    `${effect.effectModules} modules; the package ships ${dist.files} JavaScript files, ` +
    `${dist.bytes} B`,
)

for (const variant of VARIANTS) {
  const cadence = codeLines(variant.cadence.file)
  const drain = codeLines(variant.drain.file)

  console.log(
    `${variant.name} lines without blanks and comments: ${variant.cadence.file} ${cadence}, ` +
      `${variant.drain.file} ${drain}, total ${cadence + drain}`,
  )
}
