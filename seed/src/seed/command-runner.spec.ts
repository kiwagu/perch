import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'

import { describe, expect, it } from 'vitest'

import { OPERATOR_CLI, spawnCommand } from './command-runner'

describe('OPERATOR_CLI', () => {
  it("is the operator command's entry, found from the seed's own file", () => {
    expect(isAbsolute(OPERATOR_CLI)).toBe(true)
    expect(OPERATOR_CLI.endsWith('/apps/gateway/scripts/operator/cli.ts')).toBe(true)
    expect(existsSync(OPERATOR_CLI)).toBe(true)
  })
})

describe('spawnCommand', () => {
  it('answers the exit code of the command it runs, zero or not', async () => {
    expect(await spawnCommand([process.execPath, '-e', 'process.exit(0)'])).toBe(0)
    expect(await spawnCommand([process.execPath, '-e', 'process.exit(3)'])).toBe(3)
  })

  it("runs from the repository's root, not from the directory the seed was started in", async () => {
    // The spec runs from the seed package: only the root has the operator command at this path.
    const fromRoot = [
      process.execPath,
      '-e',
      "process.exit(require('node:fs').existsSync('apps/gateway/scripts/operator/cli.ts') ? 0 : 5)",
    ]

    expect(await spawnCommand(fromRoot)).toBe(0)
  })

  it('rejects, without the arguments it was given, when the command cannot be started', async () => {
    const secret = 'Seed-secret-9'
    const failure = await spawnCommand(['perch-no-such-command', `--pass=${secret}`]).then(
      () => expect.unreachable('a command that does not exist cannot exit'),
      (reason: unknown) => reason,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('perch-no-such-command')
    expect(String(failure)).not.toContain(secret)
    expect(JSON.stringify(failure, Object.getOwnPropertyNames(failure))).not.toContain(secret)
  })

  it('rejects when the command ends by a signal, which is no exit code', async () => {
    const failure = await spawnCommand([
      process.execPath,
      '-e',
      "process.kill(process.pid, 'SIGKILL')",
    ]).then(
      () => expect.unreachable('a killed command has no exit code'),
      (reason: unknown) => reason,
    )

    expect(String(failure)).toContain('SIGKILL')
  })
})
