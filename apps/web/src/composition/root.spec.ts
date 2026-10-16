import { afterEach, describe, expect, it } from 'vitest'

import { type DataError, LOCAL_DB, SHAPE_RUNNER, WRITE_PATH } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { readSchema } from '@workspace/data/testing'

import { COMMANDS } from '../platform/commands.port'
import { SESSION } from '../platform/session.port'

import { type AppServices, type BootStep, createAppRoot } from './root'
import { memoryStorage } from './storage'

let services: AppServices | undefined

afterEach(async () => {
  await services?.close()
  services = undefined
})

const boot = (schema: string, steps: BootStep[], failures: DataError[]) =>
  createAppRoot({
    engines: nodeEngines(),
    url: 'mem://',
    schema,
    storage: memoryStorage(),
    logger: { info: () => {}, warn: () => {} },
    onStep: (step) => steps.push(step),
    onError: (error) => failures.push(error),
  })

describe('createAppRoot', () => {
  it('boots through its steps and binds every port to its token', async () => {
    const steps: BootStep[] = []
    const failures: DataError[] = []

    services = (await boot(readSchema(), steps, failures))._unsafeUnwrap()

    expect(steps).toEqual(['open-db', 'restore-session', 'ready'])
    expect(services.container.get(SHAPE_RUNNER)).toBe(services.runner)
    expect(services.container.get(WRITE_PATH)).toBe(services.writePath)
    expect(services.container.get(SESSION)).toBe(services.session)
    expect(services.container.get(COMMANDS)).toBe(services.commands)
    expect(services.container.get(LOCAL_DB)).toBeDefined()
    expect(services.session.current()).toBeUndefined()
    expect(failures).toEqual([])
  })

  it('stops at the step that failed', async () => {
    const steps: BootStep[] = []
    const result = await boot(')) unbalanced', steps, [])

    expect(result._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(steps).toEqual(['open-db'])
  })
})
