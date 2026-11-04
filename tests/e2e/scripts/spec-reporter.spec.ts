import { describe, expect, it } from 'bun:test'

import SpecReporter, { type LoggedResult, type LoggedTest } from './spec-reporter'

/** The reporter with its terminal kept in memory. */
class ReadReporter extends SpecReporter {
  text = ''

  protected override write(text: string): void {
    this.text += text
  }
}

const aTest = (project: string, file: string, title: string, retries = 0): LoggedTest => ({
  titlePath: () => ['', project, file, 'Scenario', title],
  tags: ['@smoke'],
  expectedStatus: 'passed',
  retries,
})

const aRun = (fields: Partial<LoggedResult> = {}): LoggedResult => ({
  status: 'passed',
  duration: 4200,
  retry: 0,
  errors: [],
  stdout: [],
  stderr: [],
  attachments: [],
  ...fields,
})

const begin = (tests: readonly LoggedTest[]): ReadReporter => {
  const reporter = new ReadReporter()

  reporter.onBegin({ workers: 3 }, { allTests: () => tests })

  return reporter
}

describe('the spec reporter', () => {
  const signUpPhone = aTest('mobile', 'user/sign-up.e2e.spec.ts', 'signs up')
  const signUpDesktop = aTest('desktop', 'user/sign-up.e2e.spec.ts', 'signs up')
  const notes = aTest('mobile', 'org/notes.e2e.spec.ts', 'shares a note')

  it('prints a file once its last test ended, its tests in the order of the run', () => {
    const reporter = begin([signUpPhone, notes, signUpDesktop])

    reporter.onTestEnd(signUpDesktop, aRun({ duration: 3900 }))
    expect(reporter.text).toBe('Running 3 tests in 2 spec files on 3 workers\n\n')

    reporter.onTestEnd(notes, aRun())
    reporter.onTestEnd(signUpPhone, aRun())

    expect(reporter.text.split('\n').slice(2)).toEqual([
      'org/notes.e2e.spec.ts',
      '  ✓ mobile   Scenario › shares a note @smoke  4.2s',
      '',
      'user/sign-up.e2e.spec.ts',
      '  ✓ mobile   Scenario › signs up @smoke  4.2s',
      '  ✓ desktop  Scenario › signs up @smoke  3.9s',
      '',
      '',
    ])
  })

  it("keeps a test's output under its line, and prints a failure's error and files", () => {
    const reporter = begin([notes])

    reporter.onStdOut('runner line\n', undefined)
    reporter.onStdOut('kept for the block\n', notes)
    reporter.onTestEnd(
      notes,
      aRun({
        status: 'failed',
        stdout: ['kept for the block\n'],
        errors: [{ message: '\u001b[31mexpected\u001b[39m visible' }],
        attachments: [
          { name: 'trace', contentType: 'application/zip', path: `${process.cwd()}/t/trace.zip` },
        ],
      }),
    )

    expect(reporter.text).toContain('runner line\n')
    expect(reporter.text).toContain(
      [
        'org/notes.e2e.spec.ts',
        '  ✘ mobile  Scenario › shares a note @smoke  4.2s',
        '      expected visible',
        '      kept for the block',
        '      trace: t/trace.zip',
      ].join('\n'),
    )
  })

  it('waits for the last retry, and tallies the run with its failed and flaky tests again', () => {
    const flaky = aTest('mobile', 'user/sign-up.e2e.spec.ts', 'signs up', 1)
    const reporter = begin([flaky, notes, signUpDesktop])

    reporter.onTestEnd(flaky, aRun({ status: 'failed' }))
    reporter.onTestEnd(signUpDesktop, aRun())
    expect(reporter.text).not.toContain('user/sign-up.e2e.spec.ts')

    reporter.onTestEnd(flaky, aRun({ retry: 1 }))
    reporter.onTestEnd(notes, aRun({ status: 'timedOut', duration: 60_000 }))
    reporter.onEnd({ status: 'failed', duration: 150_000 })

    expect(reporter.text).toContain('  ± mobile   Scenario › signs up @smoke  4.2s (retry #1)')
    expect(reporter.text).toEndWith(
      [
        '3 tests: 1 passed, 1 failed, 1 flaky, 0 skipped, 0 not run (failed, 150.0s)',
        '',
        'Failed:',
        '  ✘ mobile   org/notes.e2e.spec.ts › Scenario › shares a note @smoke  60.0s',
        '',
        'Flaky:',
        '  ± mobile   user/sign-up.e2e.spec.ts › Scenario › signs up @smoke  4.2s (retry #1)',
        '',
      ].join('\n'),
    )
  })

  it("keeps a failed attempt's diagnostics under a test that passed on its retry", () => {
    const flaky = aTest('mobile', 'user/sign-up.e2e.spec.ts', 'signs up', 1)
    const reporter = begin([flaky])

    reporter.onTestEnd(
      flaky,
      aRun({
        status: 'failed',
        duration: 3000,
        errors: [{ message: 'expected visible' }],
        stdout: ['first try\n'],
        attachments: [
          { name: 'trace', contentType: 'application/zip', path: `${process.cwd()}/t/0/trace.zip` },
        ],
      }),
    )
    reporter.onTestEnd(flaky, aRun({ retry: 1 }))

    expect(reporter.text).toContain(
      [
        'user/sign-up.e2e.spec.ts',
        '  ± mobile  Scenario › signs up @smoke  4.2s (retry #1)',
        '      attempt 1: failed  3.0s',
        '        expected visible',
        '        first try',
        '        trace: t/0/trace.zip',
        '',
        '',
      ].join('\n'),
    )
  })

  it('counts a test stopped between its attempts as failed, with its retry not run', () => {
    const retried = aTest('mobile', 'user/sign-up.e2e.spec.ts', 'signs up', 1)
    const reporter = begin([retried, signUpDesktop])

    reporter.onTestEnd(
      retried,
      aRun({ status: 'failed', errors: [{ message: 'expected visible' }] }),
    )
    reporter.onEnd({ status: 'interrupted', duration: 10_000 })

    expect(reporter.text).toContain(
      [
        'user/sign-up.e2e.spec.ts',
        '  ✘ mobile   Scenario › signs up @smoke  4.2s (its retry did not run)',
        '      expected visible',
        '  · desktop  Scenario › signs up @smoke  not run',
      ].join('\n'),
    )
    expect(reporter.text).toContain('2 tests: 0 passed, 1 failed, 0 flaky, 0 skipped, 1 not run')
  })

  it('leaves the terminal to the listing of `playwright test --list`', () => {
    expect(new SpecReporter({ _mode: 'list' }).printsToStdio()).toBe(false)
    expect(new SpecReporter({ _mode: 'test' }).printsToStdio()).toBe(true)
  })

  it('names at the end every file whose tests did not all run, one that never started too', () => {
    const reporter = begin([signUpPhone, signUpDesktop, notes])

    reporter.onTestEnd(signUpPhone, aRun({ status: 'interrupted' }))
    reporter.onEnd({ status: 'interrupted', duration: 10_000 })

    expect(reporter.text).toContain(
      [
        'user/sign-up.e2e.spec.ts',
        '  ✘ mobile   Scenario › signs up @smoke  4.2s',
        '  · desktop  Scenario › signs up @smoke  not run',
        '',
        'org/notes.e2e.spec.ts',
        '  · mobile   Scenario › shares a note @smoke  not run',
      ].join('\n'),
    )
    expect(reporter.text).toContain('3 tests: 0 passed, 1 failed, 0 flaky, 0 skipped, 2 not run')
  })

  it("prints an error's stack and its cause, without control characters", () => {
    const reporter = begin([notes])

    reporter.onTestEnd(
      notes,
      aRun({
        status: 'failed',
        errors: [
          {
            message: 'Error: outer\r',
            location: { file: `${process.cwd()}/a.ts`, line: 1, column: 2 },
            stack: `Error: outer\n    at step (${process.cwd()}/a.ts:1:2)\n    at run (b.ts:3:4)`,
            cause: { message: 'inner\u0007 cause', stack: 'Error: inner\n    at deep (c.ts:5:6)' },
          },
        ],
      }),
    )

    expect(reporter.text).toContain(
      [
        '      Error: outer',
        '          at step (a.ts:1:2)',
        '          at run (b.ts:3:4)',
        '      [cause]: inner cause',
        '          at deep (c.ts:5:6)',
      ].join('\n'),
    )
    expect(reporter.text).not.toContain('      at a.ts:1:2')
  })

  it('prints where an error was thrown when its stack names no frame', () => {
    const reporter = begin([notes])

    reporter.onTestEnd(
      notes,
      aRun({
        status: 'failed',
        errors: [
          { message: 'timed out', location: { file: `${process.cwd()}/a.ts`, line: 1, column: 2 } },
        ],
      }),
    )

    expect(reporter.text).toContain('      timed out\n      at a.ts:1:2\n')
  })
})
