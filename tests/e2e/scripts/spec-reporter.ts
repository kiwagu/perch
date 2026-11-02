import { relative } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

import type {
  FullConfig,
  FullResult,
  Reporter,
  TestError,
  TestResult,
} from '@playwright/test/reporter'

/** What the log reads of a test: where it is (`['', project, file, ...titles]`) and its tags. */
export interface LoggedTest {
  titlePath(): string[]
  readonly tags: readonly string[]
  readonly expectedStatus: TestResult['status']
  readonly retries: number
}

/** What the log reads of a test's run. */
export type LoggedResult = Pick<
  TestResult,
  'status' | 'duration' | 'retry' | 'errors' | 'stdout' | 'stderr' | 'attachments'
>

/** The run's tests, in the order the configuration lists their projects and files. */
export interface LoggedSuite {
  allTests(): readonly LoggedTest[]
}

const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

const indent = (text: string, by: string): string =>
  text
    .trimEnd()
    .split('\n')
    .map((line) => `${by}${line}`)
    .join('\n')

/** A control character other than a tab or a line feed (C0, DEL and C1). */
const isControl = (char: string): boolean =>
  char !== '\t' && char !== '\n' && (char < ' ' || (char >= '\u007f' && char <= '\u009f'))

/** Text as the log prints it: no terminal escape and no other control character. */
const plain = (text: string | Buffer): string =>
  [...stripVTControlCharacters(text.toString())].filter((char) => !isControl(char)).join('')

/**
 * Whether a run is the test's last: it went as expected, was skipped or interrupted, or had no
 * retry left.
 */
const isLast = (test: LoggedTest, result: LoggedResult): boolean =>
  result.status === 'skipped' ||
  result.status === 'interrupted' ||
  result.status === test.expectedStatus ||
  result.retry >= test.retries

const failed = (test: LoggedTest, result: LoggedResult): boolean =>
  result.status !== 'skipped' && result.status !== test.expectedStatus

/** A test that ran and passed only on a retry. */
const flaky = (test: LoggedTest, result: LoggedResult): boolean =>
  !failed(test, result) && result.status !== 'skipped' && result.retry > 0

/** What Playwright hands a reporter it builds: `_mode` is `list` under `playwright test --list`. */
export interface SpecReporterOptions {
  readonly _mode?: string
}

/**
 * The suite's log when several workers run it: each spec file's tests printed together, once the
 * last of them ended, one line each (its outcome, project, title, tags and time) with, under it,
 * the errors of a failed run, the output any run wrote and where a failed run's trace is, each
 * attempt under a header of its own when a test was retried; then the run's tally with the failed
 * and the flaky tests again. When the run stops early, every file not printed yet is printed at
 * the end: a test stopped before its retry with the attempts it had, one that never started as
 * not run. Under `--list` it prints nothing, so Playwright prints its own listing.
 */
export default class SpecReporter implements Reporter {
  /** Each spec file's tests, every attempt of each test, the tests done, and the files printed. */
  private readonly files = new Map<string, LoggedTest[]>()
  private readonly attempts = new Map<LoggedTest, LoggedResult[]>()
  private readonly done = new Set<LoggedTest>()
  private readonly printed = new Set<string>()
  private readonly listing: boolean
  private projectWidth = 0

  constructor(options: SpecReporterOptions = {}) {
    this.listing = options._mode === 'list'
  }

  printsToStdio(): boolean {
    return !this.listing
  }

  onBegin(config: Pick<FullConfig, 'workers'>, suite: LoggedSuite): void {
    const tests = suite.allTests()

    for (const test of tests) {
      const [, project = '', file = ''] = test.titlePath()

      this.files.set(file, [...(this.files.get(file) ?? []), test])
      this.projectWidth = Math.max(this.projectWidth, project.length)
    }

    this.write(
      `Running ${tests.length} tests in ${this.files.size} spec files on ${config.workers} workers\n\n`,
    )
  }

  onTestEnd(test: LoggedTest, result: LoggedResult): void {
    this.attempts.set(test, [...(this.attempts.get(test) ?? []), result])

    if (!isLast(test, result)) {
      return
    }

    this.done.add(test)

    const [, , file = ''] = test.titlePath()
    const tests = this.files.get(file) ?? []

    if (tests.every((each) => this.done.has(each))) {
      this.printFile(file, tests)
    }
  }

  onStdOut(chunk: string | Buffer, test?: unknown): void {
    // A test's output waits for its file's block; the runner's own goes out at once.
    if (test === undefined) {
      this.write(plain(chunk))
    }
  }

  onStdErr(chunk: string | Buffer, test?: unknown): void {
    this.onStdOut(chunk, test)
  }

  onError(error: TestError): void {
    this.write(`${this.describe(error)}\n\n`)
  }

  onEnd(result: Pick<FullResult, 'status' | 'duration'>): void {
    for (const [file, tests] of this.files) {
      if (!this.printed.has(file)) {
        this.printFile(file, tests)
      }
    }

    const all = [...this.files.values()].flat()
    const runs = all.flatMap((test) => {
      const run = this.attempts.get(test)?.at(-1)

      return run ? [{ test, run }] : []
    })
    const pick = (keep: (test: LoggedTest, run: LoggedResult) => boolean) =>
      runs.filter(({ test, run }) => keep(test, run))
    const failures = pick(failed)
    const flakes = pick(flaky)
    const passed = pick(
      (test, run) => !failed(test, run) && run.status !== 'skipped' && run.retry === 0,
    ).length
    const skipped = pick((_, run) => run.status === 'skipped').length
    const list = (title: string, tests: typeof runs) =>
      tests.length > 0
        ? `\n${title}:\n${tests.map(({ test, run }) => this.line(test, run, true)).join('\n')}\n`
        : ''

    this.write(
      `${all.length} tests: ${passed} passed, ${failures.length} failed, ` +
        `${flakes.length} flaky, ${skipped} skipped, ${all.length - runs.length} not run ` +
        `(${result.status}, ${seconds(result.duration)})\n` +
        list('Failed', failures) +
        list('Flaky', flakes),
    )
  }

  /** Writes to the terminal, but under `--list`; the spec reads it instead. */
  protected write(text: string): void {
    if (!this.listing) {
      process.stdout.write(text)
    }
  }

  private printFile(file: string, tests: readonly LoggedTest[]): void {
    this.printed.add(file)

    const lines = tests.flatMap((test) => {
      const runs = this.attempts.get(test) ?? []
      const last = runs.at(-1)

      return last
        ? [this.line(test, last, false), ...this.details(test, runs)]
        : [this.notRun(test)]
    })

    this.write(`${file}\n${lines.join('\n')}\n\n`)
  }

  private line(test: LoggedTest, run: LoggedResult, withFile: boolean): string {
    const [, project = '', file = '', ...titles] = test.titlePath()
    const mark =
      run.status === 'skipped' ? '-' : failed(test, run) ? '✘' : run.retry > 0 ? '±' : '✓'
    // A test the run stopped before its next attempt is not done, its last run being a failure.
    const notes = [
      ...(run.retry > 0 ? [`retry #${run.retry}`] : []),
      ...(this.done.has(test) ? [] : ['its retry did not run']),
    ]
    const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : ''
    const title = [...(withFile ? [file] : []), ...titles].join(' › ')

    return `  ${mark} ${project.padEnd(this.projectWidth)}  ${[title, ...test.tags].join(' ')}  ${seconds(run.duration)}${suffix}`
  }

  private notRun(test: LoggedTest): string {
    const [, project = '', , ...titles] = test.titlePath()

    return `  · ${project.padEnd(this.projectWidth)}  ${[titles.join(' › '), ...test.tags].join(' ')}  not run`
  }

  /**
   * Under a test's line, for each of its runs: a failed run's errors, the output it wrote and a
   * failed run's files; when the test was retried, each run with any of these under a header.
   */
  private details(test: LoggedTest, runs: readonly LoggedResult[]): string[] {
    const retried = runs.length > 1

    return runs.flatMap((run, at) => {
      const found = this.diagnostics(test, run)

      if (!retried || found.length === 0) {
        return found.map((text) => indent(text, '      '))
      }

      return [
        `      attempt ${at + 1}: ${run.status}  ${seconds(run.duration)}`,
        ...found.map((text) => indent(text, '        ')),
      ]
    })
  }

  private diagnostics(test: LoggedTest, run: LoggedResult): string[] {
    const isFailure = failed(test, run)
    const errors = isFailure ? run.errors.map((error) => this.describe(error)) : []
    const output = [...run.stdout, ...run.stderr].map(plain).join('')
    const files = isFailure
      ? run.attachments.flatMap((attachment) =>
          attachment.path
            ? [`${attachment.name}: ${relative(process.cwd(), attachment.path)}`]
            : [],
        )
      : []

    return [...errors, ...(output.trim() ? [output] : []), ...files]
  }

  /**
   * An error as the log prints it: its message, the code around it, the frames of its stack with
   * paths from the working directory (where it was thrown when the stack names none, the whole
   * stack when it is not one of frames) and, after `[cause]:`, its cause.
   */
  private describe(error: TestError): string {
    const message = error.message ?? error.value ?? 'an error without a message'
    const stack = error.stack ?? ''
    const frames = stack
      .split('\n')
      .filter((line) => /^\s*at /.test(line))
      .map((line) => line.replaceAll(`${process.cwd()}/`, ''))
    const where = error.location
      ? `at ${relative(process.cwd(), error.location.file)}:${error.location.line}:${error.location.column}`
      : ''
    const trace =
      frames.length > 0 ? frames.join('\n') : [where, stack === message ? '' : stack].join('\n')
    const cause = error.cause ? `[cause]: ${this.describe(error.cause)}` : ''

    return [message, error.snippet ?? '', trace, cause]
      .map(plain)
      .filter((part) => part.trim() !== '')
      .join('\n')
  }
}
