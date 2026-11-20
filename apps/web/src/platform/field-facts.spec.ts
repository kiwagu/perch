import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { fieldFactsModuleOf } from '@workspace/ui-contract'
import { heldModule } from '@workspace/ui-contract/testing'

/**
 * `field-facts.gen.ts` is what `ui-contract emit fields` writes (`bun run emit`): it equals what
 * the engine emits for the contract of the working tree. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1`, and the module may still be what it emitted at the branch's merge base with
 * `main` or at the commit the branch is at, so a business commit that changes a field's fact does
 * not break the hook before the implementation emits the module again (`heldModule` of the
 * engine's `./testing` entry). `main` and `bun run check` hold it to the contract now.
 */

const ROOT = join(import.meta.dirname, '../../../..')

describe('the generated field facts', () => {
  it('are what the contract says now, or in the ahead mode what it said at the base or the head', () => {
    const committed = readFileSync(join(import.meta.dirname, 'field-facts.gen.ts'), 'utf8')

    expect(committed).toBe(
      heldModule({ committed, emit: fieldFactsModuleOf, root: ROOT, env: process.env }),
    )
  })
})
