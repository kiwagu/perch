/**
 * Ranks tracked source files by length so oversized modules surface before they harden.
 *
 * Tiers (a file takes the highest tier its line count reaches):
 *   warn      >= 300 lines: getting hard to read in one sitting
 *   refactor  >= 500 lines: carries several responsibilities, split it
 *   critical  >= 800 lines: blocks the gate when run with --ci
 *
 * Only files tracked by git are scanned, so ignored and generated output never
 * shows up. Declaration files and generated modules are skipped as well.
 *
 * Usage:
 *   bun run scripts/find-refactor-candidates.ts [paths...] [--json] [--ci]
 *     [--top N] [--include-tests] [--warn N] [--refactor N] [--critical N]
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

type Tier = 'ok' | 'warn' | 'refactor' | 'critical'

interface Thresholds {
  readonly warn: number
  readonly refactor: number
  readonly critical: number
}

interface Options {
  readonly scope: readonly string[]
  readonly thresholds: Thresholds
  readonly json: boolean
  readonly ci: boolean
  readonly top: number | undefined
  readonly includeTests: boolean
}

interface FileReport {
  readonly path: string
  readonly lines: number
  readonly tier: Tier
}

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
  const thresholds = { warn: 300, refactor: 500, critical: 800 }
  let json = false
  let ci = false
  let top: number | undefined
  let includeTests = false

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? ''

    if (arg === '--json') {
      json = true
    } else if (arg === '--ci') {
      ci = true
    } else if (arg === '--include-tests') {
      includeTests = true
    } else if (arg === '--top') {
      top = readNumber(arg, argv[++index])
    } else if (arg === '--warn' || arg === '--refactor' || arg === '--critical') {
      thresholds[arg.slice(2) as keyof Thresholds] = readNumber(arg, argv[++index])
    } else if (arg.startsWith('--')) {
      console.error(`unknown flag ${arg}`)
      process.exit(2)
    } else {
      scope.push(arg)
    }
  }

  return { scope, thresholds, json, ci, top, includeTests }
}

function tierOf(lines: number, thresholds: Thresholds): Tier {
  if (lines >= thresholds.critical) {
    return 'critical'
  }

  if (lines >= thresholds.refactor) {
    return 'refactor'
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
    .filter((report) => report.tier !== 'ok')
    .sort((left, right) => right.lines - left.lines)
}

const options = parseOptions(process.argv.slice(2))
const candidates = scan(options)
const shown = options.top === undefined ? candidates : candidates.slice(0, options.top)
const critical = candidates.filter((report) => report.tier === 'critical').length

if (options.json) {
  console.log(JSON.stringify({ thresholds: options.thresholds, candidates: shown }, null, 2))
} else if (shown.length === 0) {
  console.log(`No tracked source file reaches ${options.thresholds.warn} lines.`)
} else {
  for (const report of shown) {
    console.log(`${report.tier.padEnd(8)} ${String(report.lines).padStart(5)}  ${report.path}`)
  }
}

if (options.ci && critical > 0) {
  console.error(
    `${critical} file(s) reach the critical size of ${options.thresholds.critical} lines`,
  )
  process.exit(1)
}
