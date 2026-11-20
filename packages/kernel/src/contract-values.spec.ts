import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { valuesModuleOf } from '@workspace/ui-contract'

import { heldModule } from './emitted-module.fixture'

/**
 * `contract-values.gen.ts` is what `ui-contract emit values` writes (`bun run emit`): it equals
 * what the engine emits for the contract of the working tree. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1`, and the module may still be what it emitted at the branch's merge base with
 * `main` or at the commit the branch is at, so a business commit that changes a value does not
 * break the hook before the implementation emits the module again (`emitted-module.fixture.ts`).
 * `main` and `bun run check` hold it to the contract now.
 */

const ROOT = join(import.meta.dirname, '../../..')

describe('the generated contract values', () => {
  it('are what the contract says now, or in the ahead mode what it said at the base or the head', () => {
    const committed = readFileSync(join(import.meta.dirname, 'contract-values.gen.ts'), 'utf8')

    expect(committed).toBe(heldModule(valuesModuleOf, ROOT, committed, process.env))
  })
})
