/**
 * The contract the gateway's bounds are held to, for the specs that hold them. The gateway takes
 * every bound from the kernel's generated values (`CONTRACT_VALUES`), so it is as the contract
 * said when those values were emitted. That is the contract of the working tree; on a branch the
 * pre-commit hook sets `CONTRACT_AHEAD=1` and names the branch's merge base with `main`
 * (`CONTRACT_AHEAD_BASE`) and the commit the branch is at (`CONTRACT_AHEAD_HEAD`): a business
 * commit may change a bound before the implementation emits the values again, so the gateway may
 * still be as the contract said at either. The same choice holds the kernel's values to the
 * contract (`heldModule` of the engine's `./testing` entry), which this takes as it is.
 */

import { type Contract, valuesModuleOf } from '@workspace/ui-contract'
import { heldModule } from '@workspace/ui-contract/testing'

export interface HeldContractInput {
  /** The text of the kernel's generated values, as committed. */
  readonly committed: string
  /** The root of the repository whose contract the gateway is held to. */
  readonly root: string
  /** The variables of the spec's process, `process.env`. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/**
 * The contract the kernel's committed values were emitted from: the contract of the repository at
 * `root` now, or in the ahead mode the contract at the base or at the head when the values are
 * what it emits and not what the contract now emits. Values that none of them emitted are held to
 * the contract now, which they fail.
 */
export function heldContract({ committed, root, env }: HeldContractInput): Contract {
  const emitted = new Map<string, Contract>()
  const emit = (contract: Contract): string => {
    const text = valuesModuleOf(contract)

    // The contract now is emitted first and stays the one of its text.
    if (!emitted.has(text)) {
      emitted.set(text, contract)
    }

    return text
  }
  const held = emitted.get(heldModule({ committed, emit, root, env }))

  if (held === undefined) {
    throw new Error('the values the contract is held to were emitted from no contract')
  }

  return held
}
