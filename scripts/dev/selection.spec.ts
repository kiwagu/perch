import { describe, expect, it } from 'bun:test'

import { dryRunArgs, selectedScripts } from './selection.ts'

/** A task of `turbo run dev --dry=json`, trimmed to a few of its fields. */
const task = (workspace: string, command: string) => ({
  taskId: `${workspace}#dev`,
  task: 'dev',
  package: workspace,
  command,
  directory: workspace.replace('@workspace/', 'packages/'),
  cache: { local: false, remote: false, status: 'MISS' },
})

const GATEWAY = task('@workspace/gateway', 'bun --watch src/index.ts')
const WEB = task('@workspace/web', 'vite build --watch --mode development --outDir dist-dev')

/** What turbo prints for a dry run whose filters selected these tasks. */
const dryRun = (...tasks: object[]) => ({
  id: '3LYVsmsSrIkZqmdr3FRdyMtLfzH',
  version: '1',
  turboVersion: '2.11.8',
  monorepo: true,
  packages: tasks.length,
  envMode: 'strict',
  tasks,
})

describe('the dev scripts turbo selects', () => {
  it('are both without a filter, beside the workspaces that have no dev script', () => {
    const json = dryRun(
      task('@workspace/cqrs', '<NONEXISTENT>'),
      GATEWAY,
      task('@workspace/zod', '<NONEXISTENT>'),
      WEB,
    )

    expect(selectedScripts(json)).toEqual({ runs: { gateway: true, web: true } })
  })

  it('are the watcher alone for bun run dev -- --filter=@workspace/web', () => {
    expect(selectedScripts(dryRun(WEB))).toEqual({ runs: { gateway: false, web: true } })
  })

  it('leave out a workspace that is selected but has no dev script', () => {
    expect(selectedScripts(dryRun(task('@workspace/gateway', '<NONEXISTENT>'), WEB))).toEqual({
      runs: { gateway: false, web: true },
    })
  })

  it('refuse what is not a dry run', () => {
    expect(selectedScripts({ id: 'x' })).toEqual({
      problems: ["turbo's dry run printed what bun run dev cannot read at tasks"],
    })
  })
})

describe("the arguments of turbo's dry run", () => {
  it('ask for the tasks as JSON before the arguments that follow the task', () => {
    expect(dryRunArgs(['run', 'dev', '--filter=!@workspace/gateway', '--', '--port=1'])).toEqual([
      'run',
      'dev',
      '--dry=json',
      '--filter=!@workspace/gateway',
      '--',
      '--port=1',
    ])
  })
})
