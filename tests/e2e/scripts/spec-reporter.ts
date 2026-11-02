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

const plain = (text: string | Buffer): string => stripVTControlCharacters(text.toString())

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

/** What Playwright hands a reporter it builds: `_mode` is `list` under `playwright test --list`. */
export interface SpecReporterOptions {
  readonly _mode?: string
}

/**
 * The suite's log when several workers run it: each spec file's tests printed together, once the
 * last of them ended, one line each (its outcome, project, title, tags and time) with, under it,
 * the errors of a failed one, the output any test wrote and where a failed one's trace is; then
 * the run's tally with the failed tests again. A file whose tests did not all end (the run was
 * stopped) is printed at the end with the others marked as not run. Under `--list` it prints
 * nothing, so Playwright prints its own listing.
 */
export default class SpecReporter implements Reporter {
  /** Each spec file's tests, the last run of those that ended, and the files printed. */
  private readonly files = new Map<string, LoggedTest[]>()
  private readonly ended = new Map<LoggedTest, LoggedResult>()
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
    if (!isLast(test, result)) {
      return
    }

    this.ended.set(test, result)

    const [, , file = ''] = test.titlePath()
    const tests = this.files.get(file) ?? []

    if (tests.every((each) => this.ended.has(each))) {
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
      if (!this.printed.has(file) && tests.some((test) => this.ended.has(test))) {
        this.printFile(file, tests)
      }
    }

    const all = [...this.files.values()].flat()
    const runs = all.flatMap((test) => {
      const run = this.ended.get(test)

      return run ? [{ test, run }] : []
    })
    const count = (pick: (run: LoggedResult, test: LoggedTest) => boolean) =>
      runs.filter(({ test, run }) => pick(run, test)).length
    const failures = runs.filter(({ test, run }) => failed(test, run))

    this.write(
      `${all.length} tests: ${count((run, test) => !failed(test, run) && run.status !== 'skipped' && run.retry === 0)} passed, ` +
        `${failures.length} failed, ${count((run, test) => !failed(test, run) && run.retry > 0)} flaky, ` +
        `${count((run) => run.status === 'skipped')} skipped, ${all.length - runs.length} not run ` +
        `(${result.status}, ${seconds(result.duration)})\n`,
    )

    if (failures.length > 0) {
      this.write(
        `\nFailed:\n${failures.map(({ test, run }) => this.line(test, run, true)).join('\n')}\n`,
      )
    }
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
      const run = this.ended.get(test)

      return run ? [this.line(test, run, false), ...this.details(test, run)] : [this.notRun(test)]
    })

    this.write(`${file}\n${lines.join('\n')}\n\n`)
  }

  private line(test: LoggedTest, run: LoggedResult, withFile: boolean): string {
    const [, project = '', file = '', ...titles] = test.titlePath()
    const mark =
      run.status === 'skipped' ? '-' : failed(test, run) ? '✘' : run.retry > 0 ? '±' : '✓'
    const retry = run.retry > 0 ? ` (retry #${run.retry})` : ''
    const title = [...(withFile ? [file] : []), ...titles].join(' › ')

    return `  ${mark} ${project.padEnd(this.projectWidth)}  ${[title, ...test.tags].join(' ')}  ${seconds(run.duration)}${retry}`
  }

  private notRun(test: LoggedTest): string {
    const [, project = '', , ...titles] = test.titlePath()

    return `  · ${project.padEnd(this.projectWidth)}  ${[titles.join(' › '), ...test.tags].join(' ')}  not run`
  }

  /** Under a test's line: a failed one's errors, any output it wrote, a failed one's files. */
  private details(test: LoggedTest, run: LoggedResult): string[] {
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

    return [...errors, ...(output.trim() ? [output] : []), ...files].map((text) =>
      indent(text, '      '),
    )
  }

  private describe(error: TestError): string {
    const where = error.location
      ? `at ${relative(process.cwd(), error.location.file)}:${error.location.line}:${error.location.column}`
      : ''

    return [
      error.message ?? error.value ?? 'an error without a message',
      error.snippet ?? '',
      where,
    ]
      .filter((part) => part !== '')
      .map(plain)
      .join('\n')
  }
}
