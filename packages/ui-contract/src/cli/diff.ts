/** `ui-contract diff <ref> [--json]`. */

import { contractAt, diffContracts, formatChanges } from '../handoff'

import { currentContract } from './problems'

export function diff(argv: readonly string[]): number {
  const [ref, ...extra] = argv.filter((argument) => argument !== '--json')
  const root = process.cwd()

  if (ref === undefined || extra.length > 0) {
    console.error('ui-contract: use "diff <ref> [--json]"')

    return 1
  }

  const after = currentContract(root)

  if (after === undefined) {
    return 1
  }

  const before = contractAt(ref, root)
  const changes = diffContracts('missing' in before ? undefined : before, after)

  console.log(argv.includes('--json') ? JSON.stringify(changes, null, 2) : formatChanges(changes))

  return 0
}
