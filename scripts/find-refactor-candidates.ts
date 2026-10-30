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
 * or above the red threshold. On a checkout without one, the first `--ci` or `--update-baseline`
 * run writes it from the sizes committed where HEAD left `main`, never from the working tree,
 * so growth a branch made before its checkout's first run still fails. A file at or above the
 * red threshold that the baseline does not know fails; a baselined file that grew past its
 * recorded size fails; shrinking is always allowed, and `--update-baseline` records it.
 * Once a baseline exists it only shrinks: raising an entry or adding a file to it needs
 * `--allow-growth`, and a scoped run (with paths) never rewrites it.
 *
 * Only files tracked by git are scanned, so ignored and generated output never shows up, and
 * each is measured as the working tree holds it: a tracked path deleted from it (not yet
 * staged) or standing there as a symlink is not measured. Declaration files, generated
 * modules, fixtures and (without --include-tests) tests are skipped as well.
 *
 * Usage:
 *   bun run scripts/find-refactor-candidates.ts [paths...] [--json] [--ci] [--top N]
 *     [--include-tests] [--warn N] [--red N] [--refactor N]
 *     [--update-baseline [--allow-growth]]
 */

import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'

import {
  BASELINE_PATH,
  type Baseline,
  baselineText,
  publishBaseline,
  readBaseline,
} from './size-tiers/baseline-file.ts'
import { mainBaseline } from './size-tiers/main-baseline.ts'
import { countLines, isMeasured } from './size-tiers/measured-files.ts'
import { type Options, parseOptions, type Thresholds } from './size-tiers/options.ts'

type Tier = 'ok' | 'warn' | 'red' | 'refactor'

interface FileReport {
  readonly path: string
  readonly lines: number
  readonly tier: Tier
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

function scan(options: Options): FileReport[] {
  return trackedFiles(options.scope)
    .filter((path) => isMeasured(path, options.includeTests))
    .filter((path) => lstatSync(path, { throwIfNoEntry: false })?.isFile() === true)
    .map((path) => {
      const lines = countLines(readFileSync(path, 'utf8'))

      return { path, lines, tier: tierOf(lines, options.thresholds) }
    })
    .sort((left, right) => right.lines - left.lines)
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
function writeBaseline(reports: readonly FileReport[], baseline: Baseline, options: Options): void {
  if (options.scope.length > 0) {
    console.error('--update-baseline rewrites the whole baseline: run it without paths')
    process.exit(2)
  }

  const next: Record<string, number> = {}
  const widened: string[] = []

  for (const report of reports) {
    if (report.lines < options.thresholds.red) {
      continue
    }

    const recorded = baseline[report.path]
    const widens = recorded === undefined || report.lines > recorded

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

  publishBaseline(baselineText(next), false)
  console.log(
    `${BASELINE_PATH}: ${Object.keys(next).length} file(s) at or above ${options.thresholds.red} lines recorded`,
  )
}

/**
 * Writes this checkout's first baseline from main's sizes and returns the baseline the
 * checkout now holds: this run's, or the one a concurrent first run published a moment before.
 */
function adoptBaseline(options: Options): Baseline {
  const { base, baseline } = mainBaseline(options.thresholds.red, options.includeTests)

  if (!publishBaseline(baselineText(baseline), true)) {
    console.log(`${BASELINE_PATH} was written by a concurrent run; using that one`)

    const theirs = readBaseline()

    if (theirs === undefined) {
      throw new Error(`${BASELINE_PATH} vanished after a concurrent run published it`)
    }

    return theirs
  }

  console.log(
    `${BASELINE_PATH} did not exist on this checkout: ${Object.keys(baseline).length} file(s) at or above ${options.thresholds.red} lines recorded at ${base.slice(0, 9)}, where HEAD left main; the size ratchet starts there`,
  )

  return baseline
}

const options = parseOptions(process.argv.slice(2))
const reports = scan(options)
const adopts = options.scope.length === 0 && (options.ci || options.updateBaseline)
const stored = readBaseline() ?? (adopts ? adoptBaseline(options) : undefined)

if (options.updateBaseline) {
  writeBaseline(reports, stored ?? {}, options)
  process.exit(0)
}

const baseline: Baseline = stored ?? {}

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
