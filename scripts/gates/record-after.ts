/**
 * Runs a verification command and, when it succeeds as the suite's full run
 * (`full-run.ts`: the command alone, no arguments after it), records a receipt
 * for the tree it ran against. The receipt is the proof the pre-commit check on
 * `main` asks for before a landing is accepted; it lives in the gitignored
 * `.gates/` directory and is keyed by the working tree's id, so any later change
 * to a tracked file needs a fresh run. The tree is read before the run and again
 * after it, its id and the stamp of each file (when it was last written, its
 * size): a file written in between, even one put back to the same bytes, may
 * have been read by the suite as other content, so the run fails and records
 * nothing.
 *
 * The command's arguments pass through untouched. A run given any (a spec, a
 * filter, a reporter) passes or fails as usual and records no receipt.
 *
 * Usage: bun run scripts/gates/record-after.ts <db|e2e> -- <command> [args...]
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { FULL_RUN_SCRIPT, isFullRun } from './full-run.ts'
import { changedFiles, fileStamps, isGate, receiptPath, workingTreeId } from './tree.ts'

function usage(): never {
  console.error('Usage: bun run scripts/gates/record-after.ts <db|e2e> -- <command> [args...]')
  process.exit(2)
}

function main(argv: readonly string[]): number {
  const [gate, separator, command, ...args] = argv

  if (gate === undefined || !isGate(gate) || separator !== '--' || command === undefined) {
    usage()
  }

  const full = isFullRun(gate, [command, ...args])
  const before = full ? { treeId: workingTreeId(), stamps: fileStamps() } : undefined
  const run = spawnSync(command, args, { stdio: 'inherit' })

  if (run.error) {
    console.error(`gates: could not start ${command}: ${run.error.message}`)

    return 1
  }

  if (run.status !== 0) {
    return run.status ?? 1
  }

  if (before === undefined) {
    console.log(
      `gates: ${gate} passed on a partial run (${[command, ...args].join(' ')}): no receipt recorded; ` +
        `run \`${FULL_RUN_SCRIPT[gate]}\` without arguments for one`,
    )

    return 0
  }

  const treeId = workingTreeId()
  const changed = changedFiles(before.stamps, fileStamps())

  if (treeId !== before.treeId || changed.length > 0) {
    const named =
      changed.length > 0
        ? `files changed during the ${gate} run: ${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}`
        : `the tree changed during the ${gate} run (${before.treeId} before, ${treeId} after)`

    console.error(`gates: ${named}; no receipt recorded: run it again with no edits while it runs`)

    return 1
  }

  const receipt = receiptPath(gate, treeId)

  mkdirSync(dirname(receipt), { recursive: true })
  writeFileSync(receipt, `${new Date().toISOString()}\n`)
  console.log(`gates: ${gate} passed on tree ${treeId}, receipt recorded`)

  return 0
}

process.exit(main(process.argv.slice(2)))
