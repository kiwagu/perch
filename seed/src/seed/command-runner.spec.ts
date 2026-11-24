import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { inspect } from 'node:util'

import { describe, expect, it } from 'vitest'

import { OPERATOR_CLI, spawnCommand } from './command-runner'

describe('OPERATOR_CLI', () => {
  it("is the operator command's entry, found from the seed's own file", () => {
    expect(isAbsolute(OPERATOR_CLI)).toBe(true)
    expect(OPERATOR_CLI.endsWith('/apps/gateway/scripts/operator/cli.ts')).toBe(true)
    expect(existsSync(OPERATOR_CLI)).toBe(true)
  })
})

const secret = 'Seed-secret-9'

/** Everything an error shows of itself: its text, its own properties (hidden or not), its cause. */
function disclosed(failure: unknown): string {
  if (!(failure instanceof Error)) {
    return String(failure)
  }

  return [
    String(failure),
    JSON.stringify(failure),
    JSON.stringify(failure, Object.getOwnPropertyNames(failure)),
    inspect(failure, { depth: null, showHidden: true }),
  ].join('\n')
}

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

  it.each([
    {
      case: 'the system cannot find it (the child reports it)',
      program: 'perch-no-such-command',
      suffix: '',
    },
    {
      case: 'Node refuses an argument before any child exists (the call throws)',
      program: 'perch-no-such-command',
      suffix: '\0',
    },
  ])(
    'rejects, without the arguments it was given, when the command cannot be started: $case',
    async ({ program, suffix }) => {
      const failure = await spawnCommand([program, `--pass=${secret}${suffix}`]).then(
        () => expect.unreachable('a command that cannot be started cannot exit'),
        (reason: unknown) => reason,
      )

      expect(failure).toBeInstanceOf(Error)
      expect(disclosed(failure)).not.toContain(secret)
      expect(String(failure)).toContain(program)
      expect((failure as Error).cause).toBeUndefined()
    },
  )

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
