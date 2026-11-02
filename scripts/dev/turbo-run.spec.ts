import { describe, expect, it } from 'bun:test'

import { turboRun } from './turbo-run.ts'

describe('the turbo run of a task', () => {
  it('runs the task in every workspace when nothing is excluded', () => {
    expect(turboRun('dev', [])).toEqual({ excludes: [], args: ['run', 'dev'] })
  })

  it('filters out each excluded workspace, however it is named', () => {
    expect(turboRun('dev', ['--exclude', '@workspace/web,a', '-x', 'b', '--exclude=c'])).toEqual({
      excludes: ['@workspace/web', 'a', 'b', 'c'],
      args: ['run', 'dev', '--filter=!@workspace/web', '--filter=!a', '--filter=!b', '--filter=!c'],
    })
  })

  it('hands turbo what follows -- and any other argument as is', () => {
    expect(turboRun('dev', ['--concurrency=4', '--', '-x', '--log-order=grouped'])).toEqual({
      excludes: [],
      args: ['run', 'dev', '--concurrency=4', '-x', '--log-order=grouped'],
    })
  })
})
