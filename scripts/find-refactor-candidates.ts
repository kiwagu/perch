/**
 * Keeps source files from growing into god files. Every tracked source file is measured
 * in lines and placed in a tier:
 *
 *   warn      >= 300 lines: getting hard to read in one sitting; split it when you next touch it
 *   red       >= 400 lines: the red zone; the file may not grow any further
 *   refactor  >= 500 lines: carries several responsibilities; splitting it is due
 *
 * The gate (`--ci`) is a ratchet over the baseline `refactor-baseline.json`, a machine-local,
 * gitignored file (like the e2e screenshot baselines) that records the size of every file at
 * or above the red threshold. On a checkout without one, the first `--ci` run writes it from
 * the current tree and passes: the ratchet starts from there. Afterwards a file at or above
 * the red threshold that the baseline does not know fails; a baselined file that grew past
 * its recorded size fails; shrinking is always allowed, and `--update-baseline` records it.
 * Once a baseline exists it only shrinks: raising an entry or adding a file to it needs
 * `--allow-growth`, and a scoped run (with paths) never rewrites it.
 *
 * Only files tracked by git are scanned, so ignored and generated output never shows up.
 * Declaration files, generated modules, fixtures and (without --include-tests) tests are
 * skipped as well.
 *
 * Usage:
 *   bun run scripts/find-refactor-candidates.ts [paths...] [--json] [--ci] [--top N]
 *     [--include-tests] [--warn N] [--red N] [--refactor N]
 *     [--update-baseline [--allow-growth]]
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'

type Tier = 'ok' | 'warn' | 'red' | 'refactor'

interface Thresholds {
  readonly warn: number
  readonly red: number
  readonly refactor: number
}

interface Options {
  readonly scope: readonly string[]
  readonly thresholds: Thresholds
  readonly json: boolean
  readonly ci: boolean
  readonly top: number | undefined
  readonly includeTests: boolean
  readonly updateBaseline: boolean
  readonly allowGrowth: boolean
}

interface FileReport {
  readonly path: string
  readonly lines: number
  readonly tier: Tier
}

type Baseline = Readonly<Record<string, number>>

const BASELINE_PATH = 'refactor-baseline.json'

const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'])

const SKIPPED = [
  /^\.agents\//,
  /\.d\.ts$/,
  /\.gen\.ts$/,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
  /(^|\/)__fixtures__\//,
]

const TEST_FILE = /\.(spec|test)\.[cm]?[jt]sx?$|(^|\/)tests\/e2e\//

function readNumber(flag: string, raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '', 10)

  if (!Number.isFinite(value) || value < 0) {
    console.error(`${flag} expects a non-negative number`)
    process.exit(2)
  }

  return value
}

function parseOptions(argv: readonly string[]): Options {
  const scope: string[] = []
  const thresholds = { warn: 300, red: 400, refactor: 500 }
  let json = false
  let ci = false
  let top: number | undefined
  let includeTests = false
  let updateBaseline = false
  let allowGrowth = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''

    if (arg === '--json') {
      json = true
    } else if (arg === '--ci') {
      ci = true
    } else if (arg === '--include-tests') {
      includeTests = true
    } else if (arg === '--update-baseline') {
      updateBaseline = true
    } else if (arg === '--allow-growth') {
      allowGrowth = true
    } else if (arg === '--top') {
      top = readNumber(arg, argv[++index])
    } else if (arg === '--warn' || arg === '--red' || arg === '--refactor') {
      thresholds[arg.slice(2) as keyof Thresholds] = readNumber(arg, argv[++index])
    } else if (arg.startsWith('--')) {
      console.error(`unknown flag ${arg}`)
      process.exit(2)
    } else {
      scope.push(arg)
    }
  }

  return { scope, thresholds, json, ci, top, includeTests, updateBaseline, allowGrowth }
}

function tierOf(lines: number, thresholds: Thresholds): Tier {
  if (lines >= thresholds.refactor) {
    return 'refactor'
  }

  if (lines >= thresholds.red) {
    return 'red'
  }

  return lines >= thresholds.warn ? 'warn' : 'ok'
}

function trackedFiles(scope: readonly string[]): string[] {
  const output = execFileSync('git', ['ls-files', '-z', '--', ...(scope.length ? scope : ['.'])], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })

  return output.split('\0').filter(Boolean)
}

function countLines(path: string): number {
  const text = readFileSync(path, 'utf8')

  if (text === '') {
    return 0
  }

  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

function scan(options: Options): FileReport[] {
  return trackedFiles(options.scope)
    .filter((path) => EXTENSIONS.has(extname(path)))
    .filter((path) => !SKIPPED.some((pattern) => pattern.test(path)))
    .filter((path) => options.includeTests || !TEST_FILE.test(path))
    .map((path) => {
      const lines = countLines(path)

      return { path, lines, tier: tierOf(lines, options.thresholds) }
    })
    .sort((left, right) => right.lines - left.lines)
}

/** The baseline of this checkout, or undefined when none has been written yet. */
function readBaseline(): Baseline | undefined {
  if (!existsSync(BASELINE_PATH)) {
    return undefined
  }

  const text = readFileSync(BASELINE_PATH, 'utf8').trim()

  if (text === '') {
    console.error(`${BASELINE_PATH}: empty; write \`{}\` or run --update-baseline`)
    process.exit(2)
  }

  const parsed: unknown = JSON.parse(text)

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`${BASELINE_PATH}: expected an object of path -> lines`)
    process.exit(2)
  }

  for (const [path, lines] of Object.entries(parsed)) {
    if (typeof lines !== 'number' || !Number.isInteger(lines) || lines < 0) {
      console.error(`${BASELINE_PATH}: "${path}" must map to a non-negative integer`)
      process.exit(2)
    }
  }

  return parsed as Baseline
}

/** Why a file fails the ratchet, or undefined when it passes. */
function violationOf(
  report: FileReport,
  baseline: Baseline,
  thresholds: Thresholds,
): string | undefined {
  const recorded = baseline[report.path]

  if (recorded !== undefined) {
    return report.lines > recorded
      ? `grew from ${recorded} to ${report.lines} lines; a file in the red zone may only shrink`
      : undefined
  }

  if (report.lines >= thresholds.refactor) {
    return `${report.lines} lines: at or past ${thresholds.refactor}, split it by responsibility before committing`
  }

  if (report.lines >= thresholds.red) {
    return `${report.lines} lines: entered the red zone (${thresholds.red}); split it before it grows`
  }

  return undefined
}

/** Rewrites the baseline from the whole tree; it only shrinks unless --allow-growth says otherwise. */
function writeBaseline(
  reports: readonly FileReport[],
  baseline: Baseline | undefined,
  options: Options,
): void {
  if (options.scope.length > 0) {
    console.error('--update-baseline rewrites the whole baseline: run it without paths')
    process.exit(2)
  }

  const adopting = baseline === undefined
  const known: Baseline = baseline ?? {}
  const next: Record<string, number> = {}
  const widened: string[] = []

  for (const report of reports) {
    if (report.lines < options.thresholds.red) {
      continue
    }

    const recorded = known[report.path]
    const widens = recorded === undefined ? !adopting : report.lines > recorded

    if (widens && !options.allowGrowth) {
      widened.push(
        recorded === undefined
          ? `${report.path}: new at ${report.lines} lines`
          : `${report.path}: ${recorded} -> ${report.lines}`,
      )
      continue
    }

    next[report.path] = report.lines
  }

  if (widened.length > 0) {
    console.error(
      'the baseline only shrinks; these files grew or are new to it (pass --allow-growth with an owner decision):',
    )

    for (const line of widened) {
      console.error(`  ${line}`)
    }

    process.exit(1)
  }

  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)))
  const published = publishBaseline(`${JSON.stringify(sorted, null, 2)}\n`, adopting)

  if (!published) {
    console.log(`${BASELINE_PATH} was written by a concurrent run; using that one`)

    return
  }

  console.log(
    adopting
      ? `${BASELINE_PATH} did not exist on this checkout: ${Object.keys(sorted).length} file(s) at or above ${options.thresholds.red} lines recorded; the size ratchet starts here`
      : `${BASELINE_PATH}: ${Object.keys(sorted).length} file(s) at or above ${options.thresholds.red} lines recorded`,
  )
}

/**
 * Writes the baseline atomically: a complete file appears under its final name in one step
 * (temp file + rename), so a concurrent reader never sees a truncated one. An adoption
 * creates the file exclusively and yields to a concurrent adopter that got there first;
 * false means the file now holds the other run's baseline.
 */
function publishBaseline(content: string, adopting: boolean): boolean {
  const temp = `${BASELINE_PATH}.${process.pid}.tmp`

  writeFileSync(temp, content)

  if (!adopting) {
    renameSync(temp, BASELINE_PATH)

    return true
  }

  try {
    writeFileSync(BASELINE_PATH, content, { flag: 'wx' })

    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false
    }

    throw error
  } finally {
    rmSync(temp, { force: true })
  }
}

const options = parseOptions(process.argv.slice(2))
const reports = scan(options)
const stored = readBaseline()

if (options.updateBaseline || (options.ci && stored === undefined && options.scope.length === 0)) {
  writeBaseline(reports, stored, options)

  if (options.updateBaseline) {
    process.exit(0)
  }
}

const baseline: Baseline = stored ?? readBaseline() ?? {}

const candidates = reports.filter((report) => report.tier !== 'ok')
const shown = options.top === undefined ? candidates : candidates.slice(0, options.top)

if (options.json) {
  console.log(
    JSON.stringify(
      { thresholds: options.thresholds, baseline: BASELINE_PATH, candidates: shown },
      null,
      2,
    ),
  )
} else if (!options.ci) {
  if (shown.length === 0) {
    console.log(`No tracked source file reaches ${options.thresholds.warn} lines.`)
  }

  for (const report of shown) {
    const recorded = baseline[report.path]
    const note = recorded === undefined ? '' : `  (baseline ${recorded})`

    console.log(
      `${report.tier.padEnd(8)} ${String(report.lines).padStart(5)}  ${report.path}${note}`,
    )
  }
}

if (options.ci) {
  const violations = reports
    .map((report) => ({ report, why: violationOf(report, baseline, options.thresholds) }))
    .filter((entry) => entry.why !== undefined)

  if (violations.length > 0) {
    for (const { report, why } of violations) {
      console.error(`${report.path}: ${why}`)
    }

    console.error(
      `${violations.length} file(s) fail the size ratchet; split by responsibility, then \`bun run refactor:baseline\` records the smaller size`,
    )
    process.exit(1)
  }

  const frozen = reports.filter((report) => baseline[report.path] !== undefined).length

  if (!options.json) {
    console.log(
      `size ratchet green: ${candidates.length} file(s) past ${options.thresholds.warn} lines, ${frozen} frozen by ${BASELINE_PATH}; \`bun run refactor:scan\` lists them`,
    )
  }
}
