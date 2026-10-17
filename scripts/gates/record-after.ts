/**
 * Runs a verification command and, when it succeeds, records a receipt for the
 * tree it ran against. The receipt is the proof the pre-commit check on `main`
 * asks for before a landing is accepted; it lives in the gitignored `.gates/`
 * directory and is keyed by the working tree's id, so any later change to a
 * tracked file needs a fresh run.
 *
 * The command's arguments pass through untouched.
 *
 * Usage: bun run scripts/gates/record-after.ts <db|e2e> -- <command> [args...]
 */

import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { isGate, receiptPath, workingTreeId } from './tree.ts'

function usage(): never {
  console.error('Usage: bun run scripts/gates/record-after.ts <db|e2e> -- <command> [args...]')
  process.exit(2)
}

function main(argv: readonly string[]): number {
  const [gate, separator, command, ...args] = argv

  if (gate === undefined || !isGate(gate) || separator !== '--' || command === undefined) {
    usage()
  }

  const run = spawnSync(command, args, { stdio: 'inherit' })

  if (run.error) {
    console.error(`gates: could not start ${command}: ${run.error.message}`)

    return 1
  }

  if (run.status !== 0) {
    return run.status ?? 1
  }

  const treeId = workingTreeId()
  const receipt = receiptPath(gate, treeId)

  mkdirSync(dirname(receipt), { recursive: true })
  writeFileSync(receipt, `${new Date().toISOString()}\n`)
  console.log(`gates: ${gate} passed on tree ${treeId}, receipt recorded`)

  return 0
}

process.exit(main(process.argv.slice(2)))
