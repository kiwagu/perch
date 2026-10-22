/** The package's fixture contract, loaded as the check loads it, for the manifest's tests. */

import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type Contract, loadContract } from '../check'
import { formatProblem, MODEL_FILE, SCENARIOS_DIR, SCREENS_FILE, VOCABULARY_FILE } from '../files'

const FIXTURES = join(import.meta.dirname, '../__fixtures__')

/** The repository root, whose `contract/` holds the real contract. */
export const REPOSITORY_ROOT = join(import.meta.dirname, '../../../..')

/** A contract loaded from `root`; a problem of loading fails the test that asked. */
export function contractAt(root: string): Contract {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the contract does not load: ${problems.map(formatProblem).join('; ')}`)
  }

  return contract
}

/** The fixture contract, read from a temporary root that is removed afterwards. */
export function fixtureContract(): Contract {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-manifest-'))

  try {
    mkdirSync(join(root, 'contract'))
    cpSync(join(FIXTURES, 'vocabulary.md'), join(root, VOCABULARY_FILE))
    cpSync(join(FIXTURES, 'screens.json'), join(root, SCREENS_FILE))
    cpSync(join(FIXTURES, 'model.schema.json'), join(root, MODEL_FILE))
    cpSync(join(FIXTURES, SCENARIOS_DIR), join(root, SCENARIOS_DIR), { recursive: true })

    return contractAt(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
