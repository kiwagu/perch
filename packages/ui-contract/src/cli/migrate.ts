/** `ui-contract migrate [--write]`. */

import { migrate as migrateContract } from '../files'

export function migrate(argv: readonly string[]): number {
  const write = argv.includes('--write')
  const { from, to, steps } = migrateContract(process.cwd(), { write })

  if (steps.length === 0) {
    console.log(`ui-contract: the contract is at version ${to}, the one this engine reads`)

    return 0
  }

  for (const step of steps) {
    console.log(`${step.from} -> ${step.from + 1}: ${step.note}`)

    for (const file of step.files) {
      console.log(`  ${file}`)
    }

    for (const work of step.manual) {
      console.log(`  by hand: ${work}`)
    }
  }

  console.log(
    write
      ? `ui-contract: moved the contract from version ${from} to ${to}`
      : `ui-contract: wrote nothing; --write moves the contract from version ${from} to ${to}`,
  )

  return 0
}
