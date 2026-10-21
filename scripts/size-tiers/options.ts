/** The command line of the size script: paths to scope the scan, thresholds and modes. */

export interface Thresholds {
  readonly warn: number
  readonly red: number
  readonly refactor: number
}

export interface Options {
  readonly scope: readonly string[]
  readonly thresholds: Thresholds
  readonly json: boolean
  readonly ci: boolean
  readonly top: number | undefined
  readonly includeTests: boolean
  readonly updateBaseline: boolean
  readonly allowGrowth: boolean
}

function readNumber(flag: string, raw: string | undefined): number {
  const value = Number.parseInt(raw ?? '', 10)

  if (!Number.isFinite(value) || value < 0) {
    console.error(`${flag} expects a non-negative number`)
    process.exit(2)
  }

  return value
}

export function parseOptions(argv: readonly string[]): Options {
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
