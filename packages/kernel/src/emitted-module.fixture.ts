/**
 * The text a generated module is held to, for the spec of the package that commits one. The module
 * is what `ui-contract emit` writes for the contract of the working tree. On a branch the
 * pre-commit hook sets `CONTRACT_AHEAD=1` and names the branch's merge base with `main`
 * (`CONTRACT_AHEAD_BASE`) and the commit the branch is at (`CONTRACT_AHEAD_HEAD`): a business
 * commit may change the contract before the implementation emits the module again, so the module
 * may still be what the engine emitted for the contract at either. `main` and `bun run check` set
 * none of them, and hold it to the contract now.
 */

import { type Contract, contractAt, formatProblem, loadContract } from '@workspace/ui-contract'

/** The variables of a process: the ahead mode is three of them. */
type Variables = Readonly<Record<string, string | undefined>>

/** What `emit` makes of the contract at `revision`: nothing when none is named or it holds none. */
function emittedAt(
  emit: (contract: Contract) => string,
  revision: string | undefined,
  root: string,
): string | undefined {
  if (revision === undefined || revision === '') {
    return undefined
  }

  const contract = contractAt(revision, root)

  return 'missing' in contract ? undefined : emit(contract)
}

/**
 * The text `committed` must equal: the module `emit` makes of the contract of the repository at
 * `root` now, or, in the ahead mode, `committed` itself when it is what `emit` made of the contract
 * at the base or at the head. A module that equals none of them is held to the contract now, which
 * it fails. A revision that names no commit, or a contract at it that does not load, is an error.
 */
export function heldModule(
  emit: (contract: Contract) => string,
  root: string,
  committed: string,
  variables: Variables,
): string {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(`the contract does not load: ${problems.map(formatProblem).join('; ')}`)
  }

  const now = emit(contract)

  if (committed === now || variables['CONTRACT_AHEAD'] !== '1') {
    return now
  }

  const earlier = [variables['CONTRACT_AHEAD_BASE'], variables['CONTRACT_AHEAD_HEAD']].map(
    (revision) => emittedAt(emit, revision, root),
  )

  return earlier.find((text) => text === committed) ?? now
}
